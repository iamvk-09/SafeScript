import os
import json
import re
import io
import requests
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv

# pytesseract removed in favor of Gemini Vision
from PIL import Image

load_dotenv()

# ─── AI Setup ────────────────────────────────────────────────────────────────
try:
    import google.generativeai as genai
    AI_AVAILABLE = True
    if os.environ.get("GEMINI_API_KEY"):
        genai.configure(api_key=os.environ.get("GEMINI_API_KEY"))
    GEMINI_MODEL = "gemini-3.1-flash-lite"
except ImportError:
    AI_AVAILABLE = False

# ─── Firebase Setup ───────────────────────────────────────────────────────────
try:
    import firebase_admin
    from firebase_admin import credentials, firestore, auth as fb_auth

    _sa_env = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
    if _sa_env:
        _sa_env = _sa_env.strip().strip("'").strip('"')
        sa_dict = json.loads(_sa_env)
        cred = credentials.Certificate(sa_dict)
    else:
        # Local dev: use service account file if present
        _sa_file = os.path.join(os.path.dirname(__file__), "serviceAccountKey.json")
        if os.path.exists(_sa_file):
            cred = credentials.Certificate(_sa_file)
        else:
            cred = None

    if cred and not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
        print("SafeScript: Firebase Admin initialized.")

    db = firestore.client() if cred else None
    FIREBASE_AVAILABLE = db is not None
    if FIREBASE_AVAILABLE:
        print("SafeScript: Firestore client connected.")
except Exception as e:
    print(f"Firebase init failed: {e}")
    FIREBASE_AVAILABLE = False
    db = None

# ─── App ─────────────────────────────────────────────────────────────────────
app = FastAPI(title="SafeScript API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

base_dir = os.path.dirname(os.path.abspath(__file__))
static_path = os.path.join(base_dir, "static")
os.makedirs(static_path, exist_ok=True)

app.mount("/static", StaticFiles(directory=static_path), name="static")

# ─── Pydantic Models ─────────────────────────────────────────────────────────
class DrugEntry(BaseModel):
    name: str
    dosage: Optional[str] = None

class CheckRequest(BaseModel):
    drugs: List[DrugEntry]
    patient_age: Optional[int] = None
    patient_conditions: Optional[str] = None

class ValidateRequest(BaseModel):
    drug: str

class SaveHistoryRequest(BaseModel):
    uid: str
    drugs: List[str]
    interactions_count: int
    severity: Optional[str] = "None"
    ai_report_summary: Optional[str] = ""

# ─── Auth Helper ─────────────────────────────────────────────────────────────
def get_uid_from_token(request: Request) -> Optional[str]:
    """Extract Firebase UID from Bearer token. Returns None if not authenticated."""
    if not FIREBASE_AVAILABLE:
        return None
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header.split(" ", 1)[1]
    try:
        decoded = fb_auth.verify_id_token(token)
        return decoded["uid"]
    except Exception:
        return None

# ─── Routes ──────────────────────────────────────────────────────────────────
@app.get("/")
def read_root():
    return FileResponse(os.path.join(static_path, "index.html"))

@app.get("/admin")
def read_admin():
    return FileResponse(os.path.join(static_path, "admin.html"))

# ─── Auth Verify ─────────────────────────────────────────────────────────────
@app.get("/api/auth/verify")
async def verify_token(request: Request):
    """Verify Firebase ID token and return user info."""
    uid = get_uid_from_token(request)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid or missing token")
    try:
        user = fb_auth.get_user(uid)
        return {
            "uid": uid,
            "email": user.email,
            "displayName": user.display_name,
            "photoURL": user.photo_url,
            "isAdmin": user.email in ADMIN_EMAILS
        }
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))

# ─── History ─────────────────────────────────────────────────────────────────
@app.get("/api/history")
async def get_history(request: Request):
    """Get authenticated user's interaction history from Firestore."""
    uid = get_uid_from_token(request)
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not FIREBASE_AVAILABLE:
        return {"history": []}
    try:
        # Fetch docs for the user
        docs = (
            db.collection("interaction_history")
            .where("uid", "==", uid)
            .limit(100)
            .stream()
        )
        history = []
        for doc in docs:
            d = doc.to_dict()
            d["id"] = doc.id
            if hasattr(d.get("timestamp"), "isoformat"):
                d["timestamp"] = d["timestamp"].isoformat()
            history.append(d)
        
        # Sort in memory to avoid requiring a composite index (uid + timestamp)
        # Firestore composite indexes take time to build and can be a hurdle for new setups.
        history.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return {"history": history[:50]}
    except Exception as e:
        print(f"History fetch error: {e}")
        return {"history": [], "error": str(e)}

@app.post("/api/history/save")
async def save_history(req: SaveHistoryRequest, request: Request):
    """Save an interaction check to Firestore."""
    uid = get_uid_from_token(request)
    if not uid or uid != req.uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not FIREBASE_AVAILABLE:
        return {"saved": False, "error": "Firebase not initialized on server.", "firebase_available": False}
    try:
        doc_ref = db.collection("interaction_history").document()
        save_data = {
            "uid": uid,
            "drugs": req.drugs,
            "interactions_count": req.interactions_count,
            "severity": req.severity,
            "ai_report_summary": req.ai_report_summary[:500] if req.ai_report_summary else "",
            "timestamp": datetime.now(timezone.utc)
        }
        print(f"SafeScript: Attempting to save history for UID {uid}: {save_data}")
        doc_ref.set(save_data)
        # Update global stats
        _increment_stats(req.drugs, req.interactions_count, req.severity)
        return {"saved": True, "id": doc_ref.id}
    except Exception as e:
        import traceback
        err_detail = traceback.format_exc()
        print(f"Save history error: {err_detail}")
        return {"saved": False, "error": str(e), "details": err_detail}

@app.delete("/api/history/{doc_id}")
async def delete_history_item(doc_id: str, request: Request):
    """Delete a single history item."""
    uid = get_uid_from_token(request)
    if not uid:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not FIREBASE_AVAILABLE:
        return {"deleted": False}
    try:
        doc_ref = db.collection("interaction_history").document(doc_id)
        doc = doc_ref.get()
        if doc.exists and doc.to_dict().get("uid") == uid:
            doc_ref.delete()
            return {"deleted": True}
        raise HTTPException(status_code=403, detail="Forbidden")
    except HTTPException:
        raise
    except Exception as e:
        return {"deleted": False, "error": str(e)}

# ─── Admin ───────────────────────────────────────────────────────────────────
ADMIN_EMAILS = [e.strip() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()]

def _is_admin(uid: str) -> bool:
    if not FIREBASE_AVAILABLE or not uid:
        return False
    try:
        user = fb_auth.get_user(uid)
        return user.email in ADMIN_EMAILS
    except Exception:
        return False

def _increment_stats(drugs: List[str], interaction_count: int, severity: str):
    if not FIREBASE_AVAILABLE:
        return
    try:
        stats_ref = db.collection("stats").document("global")
        stats_ref.set({
            "total_checks": firestore.Increment(1),
            "total_interactions_found": firestore.Increment(interaction_count),
            "severe_caught": firestore.Increment(1 if severity == "Severe" else 0),
            "last_updated": datetime.now(timezone.utc)
        }, merge=True)
    except Exception as e:
        print(f"Stats update error: {e}")

@app.get("/api/admin/stats")
async def get_admin_stats(request: Request):
    uid = get_uid_from_token(request)
    if not _is_admin(uid):
        raise HTTPException(status_code=403, detail="Admin access required")
    if not FIREBASE_AVAILABLE:
        return {"stats": {}}
    try:
        stats_doc = db.collection("stats").document("global").get()
        stats = stats_doc.to_dict() if stats_doc.exists else {}
        if "last_updated" in stats and hasattr(stats["last_updated"], "isoformat"):
            stats["last_updated"] = stats["last_updated"].isoformat()

        # Efficiently count unique users using a projection
        user_docs = db.collection("interaction_history").select(["uid"]).stream()
        uids = set(d.to_dict().get("uid") for d in user_docs)
        stats["total_users"] = len(uids)

        # Cache hit potential (count of cached items)
        cache_docs = db.collection("ai_cache").stream()
        stats["cache_size"] = sum(1 for _ in cache_docs)
        
        stats["ai_available"] = AI_AVAILABLE
        stats["db_connected"] = FIREBASE_AVAILABLE

        return {"stats": stats}
    except Exception as e:
        return {"stats": {}, "error": str(e)}

@app.get("/api/admin/history")
async def get_admin_history(request: Request):
    uid = get_uid_from_token(request)
    if not _is_admin(uid):
        raise HTTPException(status_code=403, detail="Admin access required")
    if not FIREBASE_AVAILABLE:
        return {"history": []}
    try:
        docs = (
            db.collection("interaction_history")
            .order_by("timestamp", direction=firestore.Query.DESCENDING)
            .limit(100)
            .stream()
        )
        history = []
        for doc in docs:
            d = doc.to_dict()
            d["id"] = doc.id
            if hasattr(d.get("timestamp"), "isoformat"):
                d["timestamp"] = d["timestamp"].isoformat()
            history.append(d)
        return {"history": history}
    except Exception as e:
        return {"history": [], "error": str(e)}

@app.get("/api/admin/top_drugs")
async def get_top_drugs(request: Request):
    uid = get_uid_from_token(request)
    if not _is_admin(uid):
        raise HTTPException(status_code=403, detail="Admin access required")
    if not FIREBASE_AVAILABLE:
        return {"top_drugs": []}
    try:
        docs = db.collection("interaction_history").select(["drugs"]).stream()
        drug_counts = {}
        for doc in docs:
            for drug in doc.to_dict().get("drugs", []):
                drug_counts[drug] = drug_counts.get(drug, 0) + 1
        sorted_drugs = sorted(drug_counts.items(), key=lambda x: x[1], reverse=True)[:10]
        return {"top_drugs": [{"drug": k, "count": v} for k, v in sorted_drugs]}
    except Exception as e:
        return {"top_drugs": [], "error": str(e)}

# ─── AI Cache Helper ──────────────────────────────────────────────────────────
def _get_cached(key: str):
    if not FIREBASE_AVAILABLE:
        return None
    try:
        doc = db.collection("ai_cache").document(key).get()
        if doc.exists:
            data = doc.to_dict()
            expires = data.get("expires_at")
            now = datetime.now(timezone.utc)
            if expires and expires.replace(tzinfo=timezone.utc) > now:
                return data.get("result")
    except Exception:
        pass
    return None

def _set_cache(key: str, result: dict):
    if not FIREBASE_AVAILABLE:
        return
    try:
        from datetime import timedelta
        db.collection("ai_cache").document(key).set({
            "result": result,
            "cached_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7)
        })
    except Exception as e:
        print(f"Cache write error: {e}")

# ─── Drug Utilities ───────────────────────────────────────────────────────────
def extract_drugs_from_text(text: str) -> List[str]:
    key = os.environ.get("GEMINI_API_KEY", "")
    if not AI_AVAILABLE or not key or key == "your_api_key_here":
        words = re.findall(r'\b[a-zA-Z]{5,}\b', text.lower())
        return list(set(words))
    try:
        model = genai.GenerativeModel('gemini-1.5-flash')
        prompt = f"""You are a highly accurate medical text extraction AI. Extract ONLY valid, real-world medication names.
Return ONLY a comma-separated list. If no drugs found, return "NONE".

Text:
{text}"""
        response = model.generate_content(prompt)
        res_text = response.text.strip().replace('`', '').strip()
        if res_text.upper() == "NONE" or not res_text:
            return []
        return [d.strip().lower() for d in res_text.split(',') if d.strip()]
    except Exception as e:
        print(f"GenAI OCR Error: {e}")
        words = re.findall(r'\b[a-zA-Z]{5,}\b', text.lower())
        return list(set(words))

@app.post("/api/upload")
async def extract_from_image(image: UploadFile = File(...)):
    key = os.environ.get("GEMINI_API_KEY", "")
    if not AI_AVAILABLE or not key or key == "your_api_key_here":
        return {"error": "Gemini AI is required for prescription scanning.", "drugs_detected": []}
    try:
        contents = await image.read()
        pil_image = Image.open(io.BytesIO(contents))
        
        model = genai.GenerativeModel('gemini-1.5-flash')
        prompt = """You are a highly accurate medical prescription analyzer. Look at this image of a prescription or medication bottle.
Extract ONLY valid, real-world medication names.
Return ONLY a comma-separated list of the medication names. If no drugs are found, return exactly "NONE"."""
        
        response = model.generate_content([prompt, pil_image])
        res_text = response.text.strip().replace('`', '').strip()
        
        if res_text.upper() == "NONE" or not res_text:
            drugs = []
        else:
            drugs = [d.strip().lower() for d in res_text.split(',') if d.strip()]
            
        return {"text_extracted": res_text, "drugs_detected": drugs}
    except Exception as e:
        print(f"Vision OCR Error: {e}")
        return {"error": "OCR processing failed.", "details": str(e), "drugs_detected": []}

@app.post("/api/extract")
async def extract_from_text(text: str = Form(...)):
    drugs = extract_drugs_from_text(text)
    return {"drugs_detected": drugs}

def get_rxnorm_id(drug_name):
    original_name = drug_name.lower().strip()
    class_map = {
        "nsaid": "ibuprofen", "nsaids": "ibuprofen", "ssri": "sertraline",
        "ssris": "sertraline", "ppi": "omeprazole", "ppis": "omeprazole",
        "antibiotic": "amoxicillin", "antibiotics": "amoxicillin",
        "statin": "atorvastatin", "statins": "atorvastatin",
        "opioid": "morphine", "opioids": "morphine"
    }
    mapped_name = class_map.get(original_name, original_name)
    try:
        url = f"https://rxnav.nlm.nih.gov/REST/rxcui.json?name={mapped_name}"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if "idGroup" in data and "rxnormId" in data["idGroup"]:
                return data["idGroup"]["rxnormId"][0]
    except Exception as e:
        print(f"RxCUI Error: {e}")
    return None

def check_nih_interactions(rxcuis):
    if len(rxcuis) < 2:
        return []
    rxcuis_str = "+".join(rxcuis)
    url = f"https://rxnav.nlm.nih.gov/REST/interaction/list.json?rxcuis={rxcuis_str}"
    interactions = []
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if "fullInteractionTypeGroup" in data:
                for group in data["fullInteractionTypeGroup"]:
                    for int_type in group["fullInteractionType"]:
                        for interaction_pair in int_type["interactionPair"]:
                            description = interaction_pair["description"]
                            severity = interaction_pair.get("severity", "Moderate")
                            if severity == "N/A": severity = "Moderate"
                            if severity.lower() == "high": severity = "Severe"
                            elif severity.lower() not in ["mild", "moderate", "severe"]: severity = "Moderate"
                            drugs = [c["minConceptItem"]["name"].lower() for c in interaction_pair["interactionConcept"]]
                            interactions.append({
                                "drugs": drugs, "severity": severity.capitalize(),
                                "description": description, "source": "NIH RxNav API"
                            })
        return interactions
    except Exception as e:
        print(f"NIH API Error: {e}")
        return None

def generate_ai_response(prompt, safety_settings=None, use_json=True):
    config = {"response_mime_type": "application/json"} if use_json else None
    
    try:
        print("SafeScript: Trying AI model gemini-1.5-flash...")
        model = genai.GenerativeModel('gemini-1.5-flash', generation_config=config)
        return model.generate_content(prompt, safety_settings=safety_settings)
    except Exception as e:
        print(f"SafeScript: AI Error: {e}")
        raise e

@app.post("/api/validate_drug")
async def validate_drug(req: ValidateRequest):
    drug = req.drug.strip()
    key = os.environ.get("GEMINI_API_KEY", "")
    if AI_AVAILABLE and key and key != "your_api_key_here":
        try:
            prompt = f"""You are a medical spell checker. Check if "{drug}" is a correctly spelled, valid medication or drug class.
If correct: {{"valid": true, "suggestions": []}}
If wrong: {{"valid": false, "suggestions": ["CorrectName1", "CorrectName2"]}}
Return ONLY valid JSON."""
            response = generate_ai_response(prompt)
            res_text = response.text.strip()
            for marker in ["```json", "```"]:
                if res_text.startswith(marker): res_text = res_text[len(marker):]
            if res_text.endswith("```"): res_text = res_text[:-3]
            return json.loads(res_text.strip())
        except Exception as e:
            print(f"Validation Error: {e}")
    try:
        class_map = {
            "nsaid": "ibuprofen", "nsaids": "ibuprofen", "ssri": "sertraline",
            "ssris": "sertraline", "ppi": "omeprazole", "ppis": "omeprazole",
            "antibiotic": "amoxicillin", "antibiotics": "amoxicillin",
            "statin": "atorvastatin", "statins": "atorvastatin",
            "opioid": "morphine", "opioids": "morphine"
        }
        mapped_drug = class_map.get(drug.lower(), drug.lower())
        exact_url = f"https://rxnav.nlm.nih.gov/REST/drugs.json?name={mapped_drug}"
        exact_resp = requests.get(exact_url, timeout=5)
        if exact_resp.status_code == 200:
            exact_data = exact_resp.json()
            if "drugGroup" in exact_data and "conceptGroup" in exact_data["drugGroup"]:
                if any("conceptProperties" in cg for cg in exact_data["drugGroup"]["conceptGroup"]):
                    return {"valid": True, "suggestions": []}
        url = f"https://rxnav.nlm.nih.gov/REST/spellingsuggestions.json?name={drug}"
        resp = requests.get(url, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            group = data.get("suggestionGroup", {})
            suggestion_list = group.get("suggestionList", {})
            if suggestion_list and "suggestion" in suggestion_list:
                suggs = suggestion_list["suggestion"]
                if suggs and suggs[0].lower() != drug.lower():
                    return {"valid": False, "suggestions": suggs[:3]}
        import difflib
        COMMON_MEDS = [
            "aspirin", "ibuprofen", "acetaminophen", "warfarin", "lisinopril",
            "simvastatin", "amiodarone", "omeprazole", "clopidogrel", "metformin",
            "atorvastatin", "amlodipine", "azithromycin", "amoxicillin", "losartan",
            "levothyroxine", "albuterol", "gabapentin", "sertraline", "hydrochlorothiazide",
            "pantoprazole", "prednisone", "tramadol", "meloxicam", "citalopram",
        ]
        matches = difflib.get_close_matches(drug.lower(), COMMON_MEDS, n=3, cutoff=0.55)
        if matches:
            return {"valid": False, "suggestions": matches}
        return {"valid": False, "suggestions": []}
    except Exception as e:
        print(f"NIH Fallback Error: {e}")
    return {"valid": False, "suggestions": []}

@app.post("/api/check")
async def check_interactions(req: CheckRequest):
    if len(req.drugs) < 2:
        return {"interactions": [], "message": "Need at least two drugs."}
    
    input_drugs = [d.name.lower().strip() for d in req.drugs]
    cache_key = "+".join(sorted([f"{d.name.lower()}:{d.dosage.lower() if d.dosage else ''}" for d in req.drugs]))
    cached = _get_cached(cache_key)
    if cached:
        cached["from_cache"] = True
        return cached

    key = os.environ.get("GEMINI_API_KEY", "")
    if AI_AVAILABLE and key and key != "your_api_key_here":
        try:
            patient_context = ""
            if req.patient_age or req.patient_conditions:
                patient_context = "\nPatient Context:\n"
                if req.patient_age: patient_context += f"- Age: {req.patient_age}\n"
                if req.patient_conditions: patient_context += f"- Conditions: {req.patient_conditions}\n"

            drug_list_str = ", ".join([f"{d.name} ({d.dosage if d.dosage else 'dosage not specified'})" for d in req.drugs])
            prompt = f"""You are a highly knowledgeable medical AI assistant. Check drug interactions between: {drug_list_str}.
{patient_context}

Return a strictly valid JSON object:
{{
    "interactions": [
        {{
            "drugs": ["drug1", "drug2"],
            "severity": "Severe",
            "description": "Short explanation including how the specific dosages might affect the interaction.",
            "source": "AI Medical Analysis"
        }}
    ],
    "ai_report": "Detailed markdown safety report. IMPORTANT: Analyze how the provided dosages (e.g. 500mg vs 10mg) impact the risk or severity. Include a clear medical disclaimer."
}}

Rules:
1. severity MUST be exactly: "Severe", "Moderate", or "Mild"
2. If NO interactions, return empty array [] for interactions
3. No markdown code blocks in output, just raw JSON"""

            response = generate_ai_response(
                prompt,
                use_json=False
            )

            try:
                res_text = response.text.strip()
            except Exception as safety_err:
                return {"interactions": [], "ai_report": f"AI Safety Filter Blocked: {str(safety_err)}"}

            for marker in ["```json", "```"]:
                if res_text.startswith(marker): res_text = res_text[len(marker):]
            if res_text.endswith("```"): res_text = res_text[:-3]

            data = json.loads(res_text.strip())
            # Cache the result
            _set_cache(cache_key, data)
            return data

        except Exception as e:
            print(f"GenAI Check Error: {e}")
            ai_msg = f"AI analysis failed: {str(e)}"

    # NIH Fallback
    interactions = []
    rxcuis = []
    unrecognized = []
    for drug in input_drugs:
        rxcui = get_rxnorm_id(drug)
        if rxcui:
            rxcuis.append(rxcui)
        else:
            unrecognized.append(drug)

    if len(rxcuis) >= 2:
        nih_interactions = check_nih_interactions(rxcuis)
        if nih_interactions is not None:
            interactions = nih_interactions
        else:
            interactions.append({
                "drugs": ["System"], "severity": "Warning",
                "description": "Backup database unresponsive.",
                "source": "System Warning"
            })

    input_set = set(input_drugs)
    if "aspirin" in input_set and ("nsaids" in input_set or "ibuprofen" in input_set):
        if not any("aspirin" in [d.lower() for d in i["drugs"]] for i in interactions):
            interactions.append({
                "drugs": ["aspirin", "nsaids/ibuprofen"], "severity": "Severe",
                "description": "Combining NSAIDs with Aspirin significantly increases GI bleeding risk.",
                "source": "Fallback Knowledge Base"
            })

    if unrecognized:
        interactions.append({
            "drugs": unrecognized, "severity": "Warning",
            "description": "These medications were not recognized. Check spelling.",
            "source": "System Warning"
        })

    unique_interactions = []
    seen = set()
    for interaction in interactions:
        key_set = frozenset(interaction["drugs"])
        if key_set not in seen:
            seen.add(key_set)
            unique_interactions.append(interaction)

    ai_msg = locals().get("ai_msg", "AI analysis unavailable. Displaying raw NIH database results.")
    return {"interactions": unique_interactions, "ai_report": ai_msg}

if __name__ == "__main__":
    import uvicorn
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)

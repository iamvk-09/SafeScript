import os
import json
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv

load_dotenv()

def test_firebase():
    sa_env = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
    if not sa_env:
        print("Error: FIREBASE_SERVICE_ACCOUNT not found in environment")
        return

    try:
        sa_dict = json.loads(sa_env)
        cred = credentials.Certificate(sa_dict)
        if not firebase_admin._apps:
            firebase_admin.initialize_app(cred)
        db = firestore.client()
        print("Firebase initialized successfully")
        
        # Try to write a test doc
        doc_ref = db.collection("test_connection").document("test")
        doc_ref.set({"status": "ok", "timestamp": firestore.SERVER_TIMESTAMP})
        print("Write test successful")
        
        # Try to read it back
        doc = doc_ref.get()
        if doc.exists:
            print(f"Read test successful: {doc.to_dict()}")
        else:
            print("Read test failed: Doc does not exist")
            
        # Clean up
        doc_ref.delete()
        print("Cleanup successful")
        
    except Exception as e:
        print(f"Firebase test failed: {e}")

if __name__ == "__main__":
    test_firebase()

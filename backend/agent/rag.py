import os
from pathlib import Path
import chromadb
from chromadb.utils import embedding_functions

from dotenv import load_dotenv

load_dotenv()

# Create embedding function
embedding_function = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name="all-MiniLM-L6-v2"
)

# Create persistent DB
BASE_DIR = Path(__file__).resolve().parents[2]
PERSIST_DIR = BASE_DIR / "backend" / ".chroma"
client = chromadb.PersistentClient(path=str(PERSIST_DIR))

collection = client.get_or_create_collection(
    name="race_knowledge",
    embedding_function=embedding_function
)


_loaded = False


def load_documents():
    global _loaded
    if _loaded:
        return

    base_path = BASE_DIR / "knowledge"
    doc_id = 0

    for filename in sorted(os.listdir(base_path)):
        file_path = base_path / filename
        if not file_path.is_file():
            continue
        with open(file_path, "r") as f:
            content = f.read()

            chunks = content.split("\n\n")

            for chunk in chunks:
                if chunk.strip():
                    collection.upsert(
                        documents=[chunk],
                        ids=[f"doc_{doc_id}"]
                    )
                    doc_id += 1
    _loaded = True


def retrieve_context(query, k=3):
    results = collection.query(
        query_texts=[query],
        n_results=k
    )

    return "\n".join(results["documents"][0])

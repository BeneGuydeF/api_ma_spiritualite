# main.py
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI
import dotenv

DOTENV_PATH = Path(__file__).resolve().parent / ".env"
dotenv.load_dotenv(DOTENV_PATH)



app = FastAPI(title="Ma Spiritualité API")

# CORS: lis la variable CORS_ORIGIN si elle existe (séparée par des virgules), sinon autorise tout.
origins = [o.strip() for o in os.getenv("CORS_ORIGIN", "").split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI()  # lit OPENAI_API_KEY dans l'environnement
@app.get("/health/env")
def health_env():
    return {
        "has_key": bool(os.getenv("OPENAI_API_KEY")),
        "dotenv_path": str(DOTENV_PATH),
        "origins": origins,
     }
class PriereIn(BaseModel):
    prompt: str

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/api/priere")
def priere(in_: PriereIn):
    """
    Contrat attendu par l'app Flutter:
    Request JSON: { "prompt": "..." }
    Response JSON: { "response": "..." }
    """

    try:
        system_prompt = (
            "Vous êtes un assistant spirituel discret, savant et rigoureux, destiné à des lecteurs cultivés. "
            "Style sobre, impersonnel (pas de tutoiement ni d'adresse directe), précis et nuancé. "
            "Toujours une réponse en trois parties — sans puces, sans numérotation automatique — en paragraphes:\n\n"
            "1. Ancrage scripturaire: citez un ou plusieurs passages avec référence précise, en utilisant la Bible Crampon 1923 "
            "(si fournie par le contexte/les données). Donner un court extrait utile, puis éclairer brièvement la portée spirituelle.\n"
            "2. Ressource théologique: recommander un texte d’un théologien reconnu (ex. Bernardins, Communio, Ratzinger, de Lubac, Balthasar, "
            "Congar, etc.). Résumer précisément la thèse et, si un article interne du blog Keryxia est disponible, le privilégier "
            "comme source de fond (sans inventer d’URL). Mentionner l’ouvrage ou l’article clairement (titre, auteur, date si connue).\n"
            "3. Réflexion spirituelle: mentionner un ou deux saints/docteurs de l’Église (Augustin, Thomas d’Aquin, Thérèse d’Avila, "
            "Jean de la Croix, etc.) avec une citation brève et sa référence (œuvre, livre/chapitre si possible). "
            "Veiller à la cohérence doctrinale (foi catholique) et à une tonalité de consolation et de vérité.\n\n"
            "Contraintes: pas de listes à puces, pas de numérotation, pas d'excuses ou de méta-commentaires. "
            "Quand l’information précise manque, rester général sans inventer."
        )

        completion = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0.4,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": in_.prompt.strip()},
            ],
        )
        text = completion.choices[0].message.content or ""
        return {"response": text}
    except Exception as e:
        # Propage une erreur claire à l'app
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    # Démarrage local simple (en prod, préférer: uvicorn main:app --host 0.0.0.0 --port 3013)
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 3013)))

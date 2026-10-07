"""Etapa 7 - consulta real de recuperacion de contexto (Engram/memoria persistente)."""
import json
import os
import sqlite3
import sys

DB = os.environ.get(
    "OPENCODE_DB",
    os.path.join(os.path.expanduser("~"), ".local", "share", "opencode", "opencode.db"),
)
SESSION_ID = os.environ.get("SESSION_ID", "ses_eee1680f2ffeKNIkcW4lCKqD95")


def main() -> int:
    if not os.path.exists(DB):
        print(f"ERROR: no existe la base de memoria: {DB}")
        return 1
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row

    print("== 1) Sesiones anteriores guardadas (memoria persistente) ==")
    for row in con.execute(
        "SELECT id, title, directory, time_created, time_updated "
        "FROM session ORDER BY time_updated DESC LIMIT 5"
    ):
        print(f"  {row['id']} | {row['title']} | {row['directory']}")

    print(f"\n== 2) Recuperando contexto de la sesion del proyecto: {SESSION_ID} ==")
    msgs = con.execute(
        "SELECT data FROM message WHERE session_id=? ORDER BY time_created", (SESSION_ID,)
    ).fetchall()
    print(f"  mensajes recuperados: {len(msgs)}")

    print("\n== 3) Decisiones y hallazgos (primeros 12 textos de la sesion) ==")
    n = 0
    for (data,) in con.execute(
        "SELECT data FROM part WHERE session_id=? ORDER BY time_created", (SESSION_ID,)
    ):
        try:
            d = json.loads(data)
        except json.JSONDecodeError:
            continue
        text = d.get("text")
        if not text or len(text) < 20:
            continue
        print(f"  - {text[:160]}")
        n += 1
        if n >= 12:
            break

    con.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()


def get_client() -> Client:
    """
    Service-role client. The worker runs server-side and writes evidence units
    for whichever user uploaded the source, so it has to bypass RLS. This key
    must never reach the browser.
    """
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)

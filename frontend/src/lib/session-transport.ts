// Credentials stay in memory and are provided only through the desktop bridge.
let session: Promise<string | null> | null = null;

export function sessionToken(): Promise<string | null> {
  if (session) return session;
  session = new Promise((resolve, reject) => {
    const connect = async () => {
      const get = window.pywebview?.api?.get_api_session;
      if (!get) { reject(new Error("Desktop API session is unavailable")); return; }
      try {
        const value = await get();
        if (typeof value?.token !== "string" || value.token.length < 32) throw new Error("Invalid desktop API session");
        resolve(value.token);
      } catch (error) { reject(error); }
    };
    if (window.pywebview?.api?.get_api_session) { void connect(); return; }
    // Vite's server-side proxy supplies the shared development credential.
    if (import.meta.env.DEV) { resolve(null); return; }
    const ready = () => { clearTimeout(timeout); void connect(); };
    const timeout = setTimeout(() => {
      document.removeEventListener("pywebviewready", ready);
      reject(new Error("Desktop API session timed out"));
    }, 5000);
    document.addEventListener("pywebviewready", ready, { once: true });
  });
  void session.catch(() => { session = null; });
  return session;
}

export async function sessionFetch(url: string, init?: RequestInit): Promise<Response> {
  // Construct synchronously: Fragments may transfer/detach the original buffer
  // while the desktop credential is still arriving.
  const request = new Request(new URL(url, window.location.href), init);
  const token = await sessionToken();
  if (token) request.headers.set("X-IFC-Session", token);
  return fetch(request);
}

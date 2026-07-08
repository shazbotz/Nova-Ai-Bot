const BASE = "/api";

let _token: string | null = localStorage.getItem("tg_session_token");

export function setToken(token: string) {
  _token = token;
  localStorage.setItem("tg_session_token", token);
}

export function getToken(): string | null {
  return _token;
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (_token) h["Authorization"] = `Bearer ${_token}`;
  return h;
}

export async function authenticate(initData: string): Promise<{ token: string; user: unknown }> {
  const res = await fetch(`${BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData }),
  });
  if (!res.ok) throw new Error("Auth failed");
  const data = await res.json();
  setToken(data.token);
  return data;
}

export async function getMe() {
  const res = await fetch(`${BASE}/user/me`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch user");
  return res.json();
}

export async function getHistory() {
  const res = await fetch(`${BASE}/user/history`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}

export async function clearHistory() {
  const res = await fetch(`${BASE}/user/history`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to clear history");
  return res.json();
}

export async function getProviders() {
  const res = await fetch(`${BASE}/providers`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch providers");
  return res.json();
}

export async function getPlans() {
  const res = await fetch(`${BASE}/plans`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch plans");
  return res.json();
}

export async function updatePreferences(prefs: Record<string, unknown>) {
  const res = await fetch(`${BASE}/user/preferences`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error("Failed to update preferences");
  return res.json();
}

// ── Streaming chat ─────────────────────────────────────────────────────────────
export async function streamChat(
  message: string,
  preferredProvider?: string,
  preferredModel?: string,
  onChunk?: (chunk: string) => void,
  onDone?: (model: string, provider: string, creditsRemaining: number) => void,
  onError?: (msg: string) => void
): Promise<void> {
  const res = await fetch(`${BASE}/chat/stream`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ message, preferredProvider, preferredModel }),
  });

  if (res.status === 402) {
    const data = await res.json();
    onError?.(data.message || "No credits remaining");
    return;
  }

  if (!res.ok) {
    onError?.("Request failed");
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === "chunk") {
          onChunk?.(event.content);
        } else if (event.type === "done") {
          onDone?.(event.model, event.provider, event.creditsRemaining);
        } else if (event.type === "error") {
          onError?.(event.message);
        }
      } catch {}
    }
  }
}

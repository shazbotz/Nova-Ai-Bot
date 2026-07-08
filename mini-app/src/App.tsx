import { useState, useEffect } from "react";
import { authenticate, getMe, setToken } from "./lib/api";
import { UserData, CreditInfo } from "./types";
import Chat from "./pages/Chat";
import Settings from "./pages/Settings";
import Plans from "./pages/Plans";
import BottomNav from "./components/BottomNav";

type Tab = "chat" | "settings" | "plans";

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const [user, setUser] = useState<UserData | null>(null);
  const [credits, setCredits] = useState<CreditInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check URL hash for initial tab (e.g. opened from /plan button)
    const hash = window.location.hash.replace("#", "");
    if (hash === "plans" || hash === "settings") setTab(hash as Tab);

    initAuth();
  }, []);

  async function initAuth() {
    try {
      const tg = window.Telegram?.WebApp;
      const initData = tg?.initData || "";

      if (initData) {
        await authenticate(initData);
      } else {
        // Dev mode: try a stored token first, but don't get stuck if it's
        // stale/expired — fall back to requesting a fresh dev token instead
        // of endlessly retrying the same bad token.
        const stored = localStorage.getItem("tg_session_token");
        let authedOk = false;
        if (stored) {
          setToken(stored);
          try {
            await getMe();
            authedOk = true;
          } catch {
            localStorage.removeItem("tg_session_token");
          }
        }
        if (!authedOk) {
          const res = await fetch("/api/auth?dev_user=123456789", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData: "" }),
          });
          if (res.ok) {
            const data = await res.json();
            setToken(data.token);
          } else {
            throw new Error("Authentication failed");
          }
        }
      }

      const meData = await getMe();
      setUser(meData.user);
      setCredits(meData.credits);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  function refreshUser() {
    getMe().then((d) => {
      setUser(d.user);
      setCredits(d.credits);
    }).catch(() => {});
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh", flexDirection: "column", gap: 12 }}>
        <div className="spinner" />
        <span style={{ color: "var(--hint)", fontSize: 14 }}>Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh", padding: 24, flexDirection: "column", gap: 16, textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <div style={{ fontWeight: 600 }}>Could not connect</div>
        <div style={{ color: "var(--hint)", fontSize: 14 }}>{error}</div>
        <button onClick={() => { setError(null); setLoading(true); initAuth(); }} style={{ background: "var(--btn)", color: "var(--btn-text)", padding: "10px 24px", borderRadius: 10, fontWeight: 600 }}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden" }}>
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {tab === "chat" && <Chat user={user} credits={credits} onCreditsChange={setCredits} />}
        {tab === "settings" && <Settings user={user} onUpdate={refreshUser} />}
        {tab === "plans" && <Plans user={user} credits={credits} />}
      </div>
      <BottomNav active={tab} onChange={(t) => setTab(t as Tab)} />
    </div>
  );
}

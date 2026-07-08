import { useState } from "react";
import { updatePreferences } from "../lib/api";
import { UserData } from "../types";

interface Props {
  user: UserData | null;
  onUpdate: () => void;
}

const PERSONAS = [
  { label: "Default Assistant", prompt: "" },
  { label: "🧑‍💻 Senior Developer", prompt: "You are a senior software engineer. Give precise, production-ready code with explanations. Prefer TypeScript/Python. Avoid unnecessary chatter." },
  { label: "📚 Patient Teacher", prompt: "You are a patient and encouraging teacher. Explain concepts step by step with simple examples. Check for understanding." },
  { label: "🎨 Creative Writer", prompt: "You are a creative writing assistant. Help with storytelling, characters, dialogue, and world-building. Be imaginative and expressive." },
  { label: "⚖️ Legal Analyst", prompt: "You are a legal research assistant. Analyze legal questions carefully and cite relevant principles. Always note you are not providing legal advice." },
  { label: "📊 Data Analyst", prompt: "You are a data analysis expert. Help interpret data, suggest visualizations, write SQL/Python for analysis, and explain statistical concepts." },
  { label: "💪 Fitness Coach", prompt: "You are an enthusiastic fitness and wellness coach. Give practical workout advice, nutrition tips, and motivational support." },
];

export default function Settings({ user, onUpdate }: Props) {
  const [systemPrompt, setSystemPrompt] = useState(user?.preferences?.systemPrompt || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await updatePreferences({ systemPrompt });
      onUpdate();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
    } catch {
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
    } finally {
      setSaving(false);
    }
  }

  function selectPersona(prompt: string) {
    setSystemPrompt(prompt);
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
  }

  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.username || "User";

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "16px 16px 24px" }}>

      {/* User card */}
      <div style={{
        background: "var(--bg2)", borderRadius: 16, padding: 16,
        marginBottom: 20, display: "flex", alignItems: "center", gap: 12,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 24,
          background: "var(--btn)", color: "var(--btn-text)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, fontWeight: 700, flexShrink: 0,
        }}>
          {displayName.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{displayName}</div>
          {user?.username && <div style={{ color: "var(--hint)", fontSize: 13 }}>@{user.username}</div>}
          <div style={{ fontSize: 12, color: "var(--hint)", marginTop: 2 }}>
            📨 {user?.stats?.totalMessages ?? 0} messages · 📄 {user?.stats?.filesProcessed ?? 0} files
          </div>
        </div>
      </div>

      {/* Personas */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: "var(--hint)", textTransform: "uppercase", letterSpacing: 0.5 }}>
          Quick Personas
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {PERSONAS.map((p) => {
            const isActive = systemPrompt === p.prompt;
            return (
              <button
                key={p.label}
                onClick={() => selectPersona(p.prompt)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 14px", borderRadius: 12, textAlign: "left",
                  background: isActive ? "var(--btn)" : "var(--bg2)",
                  color: isActive ? "var(--btn-text)" : "var(--text)",
                  fontSize: 14, fontWeight: isActive ? 600 : 400,
                  transition: "all 0.15s",
                }}
              >
                <span>{p.label}</span>
                {isActive && <span style={{ fontSize: 12 }}>✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom system prompt */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, color: "var(--hint)", textTransform: "uppercase", letterSpacing: 0.5 }}>
          Custom System Prompt
        </div>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Describe how you want the AI to behave…"
          rows={5}
          style={{
            width: "100%", resize: "vertical",
            background: "var(--bg2)", color: "var(--text)",
            borderRadius: 12, padding: "12px 14px",
            fontSize: 14, lineHeight: 1.5,
            border: "1px solid rgba(128,128,128,0.15)",
            minHeight: 100,
          }}
        />
        <div style={{ fontSize: 12, color: "var(--hint)", marginTop: 4 }}>
          {systemPrompt.length} characters
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          width: "100%", padding: "14px",
          background: saved ? "#22c55e" : "var(--btn)",
          color: "var(--btn-text)",
          borderRadius: 14, fontSize: 15, fontWeight: 600,
          transition: "all 0.2s",
        }}
      >
        {saving ? "Saving…" : saved ? "✓ Saved!" : "Save Settings"}
      </button>

      {/* About section */}
      <div style={{ marginTop: 24, padding: 14, background: "var(--bg2)", borderRadius: 14, fontSize: 13, color: "var(--hint)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--text)" }}>AI Providers:</strong> OpenAI · Anthropic · Gemini · Groq<br />
        <strong style={{ color: "var(--text)" }}>Auto-fallback:</strong> Tries each provider in priority order<br />
        <strong style={{ color: "var(--text)" }}>Memory:</strong> Last 20 messages kept as context
      </div>
    </div>
  );
}

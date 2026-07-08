import { useState, useEffect, useRef, useCallback } from "react";
import { streamChat, clearHistory, getHistory, getProviders } from "../lib/api";
import { UserData, CreditInfo, ChatMessage, Provider } from "../types";

interface Props {
  user: UserData | null;
  credits: CreditInfo | null;
  onCreditsChange: (c: CreditInfo) => void;
}

function renderMarkdown(text: string): string {
  // Escape the entire response first so any literal <, >, & in the AI's reply
  // can't be interpreted as HTML (previously only fenced/inline code was
  // escaped, leaving the rest of the text vulnerable when injected via
  // dangerouslySetInnerHTML). None of the escaped entities collide with the
  // markdown delimiters matched below, so it's safe to run these replacements
  // on the escaped string.
  const escaped = escapeHtml(text);
  return escaped
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/^#{1,3}\s(.+)$/gm, (_, t) => `<strong>${t}</strong>`)
    .replace(/\n/g, "<br/>");
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  model?: string;
  streaming?: boolean;
}

export default function Chat({ user, credits, onCreditsChange }: Props) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadHistory();
    loadProviders();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadHistory() {
    try {
      const data = await getHistory();
      const msgs: DisplayMessage[] = data.messages
        .filter((m: ChatMessage) => m.role !== "system")
        .map((m: ChatMessage) => ({ role: m.role as "user" | "assistant", content: m.content, model: m.model }));
      setMessages(msgs);
    } catch {}
  }

  async function loadProviders() {
    try {
      const data = await getProviders();
      setProviders(data.providers.filter((p: Provider) => p.enabled));
      // Pre-select user's preferred provider/model
      if (user?.preferences?.preferredProvider) {
        setSelectedProvider(user.preferences.preferredProvider);
        if (user?.preferences?.preferredModel) setSelectedModel(user.preferences.preferredModel);
      }
    } catch {}
  }

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setError(null);
    textareaRef.current?.style.setProperty("height", "auto");

    // Add user message
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    // Add empty assistant bubble
    setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);
    setIsStreaming(true);

    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");

    let fullContent = "";

    await streamChat(
      text,
      selectedProvider || undefined,
      selectedModel || undefined,
      (chunk) => {
        fullContent += chunk;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: fullContent, streaming: true };
          return updated;
        });
      },
      (model, provider, creditsRemaining) => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: fullContent, streaming: false, model };
          return updated;
        });
        onCreditsChange({ ...credits!, creditsRemaining });
        setIsStreaming(false);
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
      },
      (errMsg) => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: `❌ ${errMsg}`, streaming: false };
          return updated;
        });
        setError(errMsg);
        setIsStreaming(false);
        window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
      }
    );
  }, [input, isStreaming, selectedProvider, selectedModel, credits, onCreditsChange]);

  async function handleClear() {
    await clearHistory();
    setMessages([]);
    setError(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  }

  const currentModels = providers.find((p) => p.slug === selectedProvider)?.models || [];
  const creditLabel = credits
    ? credits.isUnlimited
      ? "∞"
      : `${credits.creditsRemaining}`
    : "…";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 12px", background: "var(--bg2)",
        borderBottom: "1px solid rgba(128,128,128,0.15)",
        flexShrink: 0, minHeight: "var(--header-h)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>AI Assistant</div>
            <div style={{ fontSize: 11, color: "var(--hint)" }}>
              {selectedProvider
                ? `${selectedProvider}${selectedModel ? " / " + selectedModel : ""}`
                : "Auto model"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            background: "var(--btn)", color: "var(--btn-text)",
            borderRadius: 20, padding: "2px 10px", fontSize: 12, fontWeight: 600,
          }}>
            {creditLabel} {credits?.isUnlimited ? "♾️" : "💬"}
          </div>
          <button onClick={() => setShowModelPicker(!showModelPicker)} style={{
            background: "rgba(128,128,128,0.12)", color: "var(--text)",
            borderRadius: 8, padding: "4px 8px", fontSize: 12,
          }}>
            🔧
          </button>
          <button onClick={handleClear} style={{
            background: "rgba(128,128,128,0.12)", color: "var(--text)",
            borderRadius: 8, padding: "4px 8px", fontSize: 12,
          }}>
            🗑️
          </button>
        </div>
      </div>

      {/* Model picker dropdown */}
      {showModelPicker && (
        <div style={{
          position: "absolute", top: "var(--header-h)", right: 8, zIndex: 100,
          background: "var(--bg2)", borderRadius: 12, padding: 8,
          boxShadow: "0 4px 24px rgba(0,0,0,0.15)", minWidth: 220,
          border: "1px solid rgba(128,128,128,0.15)",
        }}>
          <div style={{ fontSize: 12, color: "var(--hint)", padding: "4px 8px 8px" }}>Select AI Model</div>
          <button
            onClick={() => { setSelectedProvider(""); setSelectedModel(""); setShowModelPicker(false); }}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "8px 12px", background: !selectedProvider ? "var(--btn)" : "none",
              color: !selectedProvider ? "var(--btn-text)" : "var(--text)",
              borderRadius: 8, fontSize: 13, fontWeight: !selectedProvider ? 600 : 400,
            }}
          >
            🔄 Auto (Best available)
          </button>
          {providers.map((p) => (
            <div key={p.slug}>
              <div style={{ fontSize: 11, color: "var(--hint)", padding: "6px 12px 2px", fontWeight: 600 }}>
                {p.name}
              </div>
              {p.models.map((m) => (
                <button
                  key={m}
                  onClick={() => { setSelectedProvider(p.slug); setSelectedModel(m); setShowModelPicker(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "6px 12px", borderRadius: 8, fontSize: 13,
                    background: selectedProvider === p.slug && selectedModel === m ? "var(--btn)" : "none",
                    color: selectedProvider === p.slug && selectedModel === m ? "var(--btn-text)" : "var(--text)",
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 0", display: "flex", flexDirection: "column", gap: 8 }}
        onClick={() => showModelPicker && setShowModelPicker(false)}>

        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--hint)", marginTop: 60, padding: "0 24px" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8, color: "var(--text)" }}>
              Hello{user?.firstName ? `, ${user.firstName}` : ""}!
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>
              Start a conversation. I can answer questions, help with code, analyze files, and more.
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{
            display: "flex",
            justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
          }}>
            {msg.role === "assistant" && (
              <div style={{ width: 28, height: 28, borderRadius: 14, background: "var(--btn)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, marginRight: 6, flexShrink: 0, alignSelf: "flex-end" }}>
                🤖
              </div>
            )}
            <div style={{
              maxWidth: "82%",
              padding: "8px 12px",
              borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
              background: msg.role === "user" ? "var(--btn)" : "var(--bg2)",
              color: msg.role === "user" ? "var(--btn-text)" : "var(--text)",
              fontSize: 14,
              lineHeight: 1.5,
              wordBreak: "break-word",
            }}>
              {msg.role === "assistant" ? (
                <>
                  {msg.content ? (
                    <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} style={{
                      ["--code-bg" as string]: "rgba(128,128,128,0.15)",
                    }} />
                  ) : (
                    <TypingDots />
                  )}
                  {!msg.streaming && msg.model && (
                    <div style={{ fontSize: 10, color: "var(--hint)", marginTop: 4 }}>
                      via {msg.model}
                    </div>
                  )}
                </>
              ) : (
                <span>{msg.content}</span>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ padding: "6px 12px", background: "rgba(255,50,50,0.1)", color: "#e53e3e", fontSize: 13, textAlign: "center" }}>
          {error}
        </div>
      )}

      {/* Input bar */}
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 8,
        padding: "8px 12px 12px",
        background: "var(--bg)",
        borderTop: "1px solid rgba(128,128,128,0.12)",
        flexShrink: 0,
      }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={autoResize}
          onKeyDown={handleKeyDown}
          placeholder="Message AI…"
          rows={1}
          disabled={isStreaming}
          style={{
            flex: 1, resize: "none", background: "var(--bg2)",
            color: "var(--text)", borderRadius: 20, padding: "10px 14px",
            fontSize: 15, lineHeight: 1.4, maxHeight: 120,
            border: "1px solid rgba(128,128,128,0.15)",
            overflowY: "auto",
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isStreaming}
          style={{
            width: 40, height: 40, borderRadius: 20, flexShrink: 0,
            background: input.trim() && !isStreaming ? "var(--btn)" : "rgba(128,128,128,0.2)",
            color: input.trim() && !isStreaming ? "var(--btn-text)" : "var(--hint)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, transition: "all 0.15s",
          }}
        >
          {isStreaming ? "⏳" : "↑"}
        </button>
      </div>

      <style>{`
        pre { background: rgba(128,128,128,0.12); border-radius: 6px; padding: 8px 10px; overflow-x: auto; margin: 4px 0; }
        code { background: rgba(128,128,128,0.12); border-radius: 4px; padding: 1px 5px; font-size: 13px; }
        pre code { background: none; padding: 0; }
        @keyframes blink { 0%,80%,100%{opacity:0} 40%{opacity:1} }
      `}</style>
    </div>
  );
}

function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 4, padding: "2px 0" }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: 3,
          background: "var(--hint)",
          animation: `blink 1.4s ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}

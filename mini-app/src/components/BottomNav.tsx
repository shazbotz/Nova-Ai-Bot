interface Props {
  active: string;
  onChange: (tab: string) => void;
}

const TABS = [
  { id: "chat", icon: "💬", label: "Chat" },
  { id: "settings", icon: "⚙️", label: "Settings" },
  { id: "plans", icon: "💎", label: "Plans" },
];

export default function BottomNav({ active, onChange }: Props) {
  return (
    <nav style={{
      display: "flex",
      height: "var(--nav-h)",
      background: "var(--bg2)",
      borderTop: "1px solid rgba(128,128,128,0.15)",
      flexShrink: 0,
    }}>
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              background: "none",
              color: isActive ? "var(--btn)" : "var(--hint)",
              fontSize: 10,
              fontWeight: isActive ? 600 : 400,
              transition: "all 0.15s",
            }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

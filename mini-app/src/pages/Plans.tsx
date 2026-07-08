import { useState, useEffect } from "react";
import { getPlans } from "../lib/api";
import { UserData, CreditInfo, Plan } from "../types";

interface Props {
  user: UserData | null;
  credits: CreditInfo | null;
}

export default function Plans({ user, credits }: Props) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPlans()
      .then((d) => setPlans(d.plans))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sub = user?.subscription;
  const periodEnd = sub?.periodEnd ? new Date(sub.periodEnd) : null;
  const resetDate = periodEnd?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const used = (sub?.creditsTotal ?? 0) - (sub?.creditsRemaining ?? 0);
  const pct = sub && sub.creditsTotal > 0 && sub.creditsTotal < 999999
    ? Math.round((used / sub.creditsTotal) * 100)
    : 0;

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "16px 16px 24px" }}>

      {/* Current plan card */}
      <div style={{
        background: "linear-gradient(135deg, var(--btn) 0%, #7c3aed 100%)",
        borderRadius: 18, padding: 20, marginBottom: 20, color: "white",
      }}>
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>CURRENT PLAN</div>
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>
          💎 {sub?.planName ?? "Free"}
        </div>

        {credits?.isUnlimited ? (
          <div style={{ fontSize: 16, fontWeight: 600 }}>Unlimited messages ♾️</div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
              <span>Messages used</span>
              <span>{used} / {sub?.creditsTotal ?? 0}</span>
            </div>
            <div style={{ height: 6, background: "rgba(255,255,255,0.3)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "white", borderRadius: 3, transition: "width 0.5s" }} />
            </div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 8 }}>
              {sub?.creditsRemaining ?? 0} remaining · Resets {resetDate}
            </div>
          </>
        )}
      </div>

      {/* Usage stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
        <StatCard icon="📨" label="Total Messages" value={user?.stats?.totalMessages ?? 0} />
        <StatCard icon="📄" label="Files Processed" value={user?.stats?.filesProcessed ?? 0} />
      </div>

      {/* Available plans */}
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: "var(--hint)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        Available Plans
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--hint)", padding: 24 }}>Loading plans…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {plans.map((plan) => {
            const isCurrent = plan.name === sub?.planName;
            return (
              <div key={plan._id} style={{
                background: "var(--bg2)", borderRadius: 14, padding: 16,
                border: isCurrent ? `2px solid var(--btn)` : "2px solid transparent",
                position: "relative",
              }}>
                {isCurrent && (
                  <div style={{
                    position: "absolute", top: 10, right: 12,
                    background: "var(--btn)", color: "var(--btn-text)",
                    borderRadius: 8, padding: "2px 8px", fontSize: 11, fontWeight: 600,
                  }}>
                    Current
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{plan.name}</div>
                    <div style={{ color: "var(--hint)", fontSize: 13 }}>{plan.description}</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 18 }}>
                      {plan.price === 0 ? "Free" : `$${plan.price}`}
                    </div>
                    {plan.price > 0 && <div style={{ color: "var(--hint)", fontSize: 11 }}>/month</div>}
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "var(--hint)", marginBottom: 8 }}>
                  💬 {plan.messagesPerMonth >= 999999 ? "Unlimited" : `${plan.messagesPerMonth} messages`}/month
                </div>
                {plan.features?.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {plan.features.map((f, i) => (
                      <div key={i} style={{ fontSize: 13, display: "flex", gap: 6 }}>
                        <span style={{ color: "var(--btn)" }}>✓</span>
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Upgrade note */}
      <div style={{
        marginTop: 20, padding: 14, background: "var(--bg2)",
        borderRadius: 14, fontSize: 13, color: "var(--hint)", textAlign: "center", lineHeight: 1.6,
      }}>
        To upgrade your plan or add credits,<br />
        contact the bot admin or use /plan in the bot chat.
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: string; label: string; value: number }) {
  return (
    <div style={{ background: "var(--bg2)", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 12, color: "var(--hint)" }}>{label}</div>
    </div>
  );
}

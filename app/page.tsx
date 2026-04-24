"use client";

import { useEffect, useMemo, useState } from "react";

const ACTION_WEBHOOK_URL = process.env.NEXT_PUBLIC_ACTION_WEBHOOK_URL?.trim() || "";

interface UserProfile {
  name: string;
  email: string;
  department: string;
}

interface AutomationAction {
  id: string;
  title: string;
  badge: string;
  summary: string;
  outcome: string;
  team: string;
  eta: string;
  actionType: string;
  payload: Record<string, string | string[]>;
}

interface RunItem {
  id: string;
  title: string;
  detail: string;
  status: "running" | "completed" | "failed";
  time: string;
}

const DEFAULT_PROFILE: UserProfile = {
  name: "Aarav Sharma",
  email: "aarav.sharma@bonfiglioli.demo",
  department: "People Operations",
};

const AUTOMATION_GROUPS: { title: string; caption: string; actions: AutomationAction[] }[] = [
  {
    title: "HR Command Center",
    caption: "One-click flows that handle the daily HR desk on their own.",
    actions: [
      {
        id: "timesheet-daily",
        title: "Run Daily Timesheets",
        badge: "Daily",
        summary: "Collect missing timesheets, send reminders, and post the final submission summary.",
        outcome: "Reminders sent, missing users flagged, manager digest prepared.",
        team: "People Ops + Managers",
        eta: "2 min",
        actionType: "daily_timesheet_run",
        payload: {
          workflow_scope: "daily_timesheet",
          reminder_window: "6:00 PM",
          escalation_team: "line_managers",
          delivery_channels: ["email", "teams"],
        },
      },
      {
        id: "leave-desk",
        title: "Process Leave Desk",
        badge: "HR",
        summary: "Review new leave requests, notify reporting managers, and queue pending approvals.",
        outcome: "Approval emails sent and HR tracker updated.",
        team: "HR Desk",
        eta: "90 sec",
        actionType: "process_leave_desk",
        payload: {
          workflow_scope: "leave_management",
          approval_mode: "manager_then_hr",
          notify_users: "true",
          leave_type: "mixed_queue",
        },
      },
      {
        id: "policy-digest",
        title: "Send Policy Digest",
        badge: "Weekly",
        summary: "Push key HR policy reminders and open items to employees automatically.",
        outcome: "Policy digest drafted and sent to all employees.",
        team: "HR Communications",
        eta: "1 min",
        actionType: "policy_digest",
        payload: {
          workflow_scope: "policy_digest",
          audience: "all_employees",
          include_deadlines: "true",
          format: "mail_and_portal",
        },
      },
    ],
  },
  {
    title: "Celebrations",
    caption: "Run delight moments automatically without anyone typing a request.",
    actions: [
      {
        id: "birthday-blast",
        title: "Send Birthday Wishes",
        badge: "Today",
        summary: "Generate birthday messages, pick the matching card, and email the employee automatically.",
        outcome: "Wish email delivered and team lead notified.",
        team: "People Experience",
        eta: "45 sec",
        actionType: "birthday_blast",
        payload: {
          workflow_scope: "birthday_wishes",
          card_style: "brand_confetti",
          tone: "warm_professional",
          cc_manager: "true",
        },
      },
      {
        id: "anniversary-blast",
        title: "Send Work Anniversaries",
        badge: "Today",
        summary: "Celebrate employee milestones with personalized anniversary wishes and recognition notes.",
        outcome: "Anniversary email sent with tenure highlights.",
        team: "People Experience",
        eta: "45 sec",
        actionType: "anniversary_blast",
        payload: {
          workflow_scope: "anniversary_wishes",
          include_tenure: "true",
          card_style: "gold_ribbon",
          notify_hrbp: "true",
        },
      },
      {
        id: "festival-pack",
        title: "Send Festival Wishes",
        badge: "Campaign",
        summary: "Broadcast cultural and festive greetings with one branded workflow.",
        outcome: "Campaign message delivered to all employees.",
        team: "HR Communications",
        eta: "1 min",
        actionType: "festival_wishes",
        payload: {
          workflow_scope: "festival_campaign",
          audience: "all_employees",
          asset_pack: "seasonal_brand_set",
          channels: ["email", "teams"],
        },
      },
    ],
  },
  {
    title: "Onboarding & Access",
    caption: "Trigger the complete joiner workflow from one button.",
    actions: [
      {
        id: "new-joiner-pack",
        title: "Start New Joiner Onboarding",
        badge: "Launch",
        summary: "Create IT tickets, send welcome mail, assign buddy, and schedule induction steps.",
        outcome: "Onboarding checklist opened across HR, IT, and admin.",
        team: "HR + IT + Admin",
        eta: "3 min",
        actionType: "new_joiner_onboarding",
        payload: {
          workflow_scope: "onboarding",
          onboarding_mode: "full_stack",
          include_buddy_assignment: "true",
          access_bundle: "standard_employee",
        },
      },
      {
        id: "access-pack",
        title: "Provision Access Pack",
        badge: "IT",
        summary: "Raise all default access, software, and device requests for a new employee batch.",
        outcome: "SAP, email, VPN, and laptop requests queued automatically.",
        team: "IT Operations",
        eta: "2 min",
        actionType: "access_pack",
        payload: {
          workflow_scope: "access_pack",
          target_group: "new_joiners",
          access_bundle: "default_enterprise_stack",
          priority: "high",
        },
      },
      {
        id: "day-one-pack",
        title: "Run Day-One Experience",
        badge: "Day 1",
        summary: "Send the welcome plan, induction slots, first-week agenda, and manager checklist.",
        outcome: "Joiner receives complete day-one instructions.",
        team: "People Ops",
        eta: "90 sec",
        actionType: "day_one_experience",
        payload: {
          workflow_scope: "day_one",
          induction_format: "hybrid",
          share_first_week_plan: "true",
          notify_manager: "true",
        },
      },
    ],
  },
];

function getTimeStamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Home() {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [draftProfile, setDraftProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [showProfileGate, setShowProfileGate] = useState(true);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string>("");
  const [bannerTone, setBannerTone] = useState<"success" | "error">("success");
  const [runs, setRuns] = useState<RunItem[]>([
    {
      id: "seed-1",
      title: "Morning HR health check",
      detail: "Attendance sync, leave queue review, and timesheet health completed.",
      status: "completed",
      time: "09:10 AM",
    },
    {
      id: "seed-2",
      title: "Welcome mailer batch",
      detail: "Three onboarding emails and buddy assignments are ready.",
      status: "running",
      time: "09:22 AM",
    },
  ]);

  useEffect(() => {
    const saved = window.sessionStorage.getItem("genio-automation-profile");
    if (!saved) {
      return;
    }

    try {
      const parsed = JSON.parse(saved) as UserProfile;
      setProfile(parsed);
      setDraftProfile(parsed);
      setShowProfileGate(false);
    } catch {
      window.sessionStorage.removeItem("genio-automation-profile");
    }
  }, []);

  const allActions = useMemo(
    () => AUTOMATION_GROUPS.flatMap((group) => group.actions),
    []
  );

  const commandCount = allActions.length;
  const activeRuns = runs.filter((run) => run.status === "running").length;
  const completedRuns = runs.filter((run) => run.status === "completed").length;

  async function triggerAction(action: AutomationAction) {
    setActiveActionId(action.id);
    setBanner("");

    const startedAt = getTimeStamp();
    const runId = `${action.id}-${Date.now()}`;

    setRuns((prev) => [
      {
        id: runId,
        title: action.title,
        detail: "Workflow launched. Orchestration is preparing HR, IT, and communication steps.",
        status: "running",
        time: startedAt,
      },
      ...prev,
    ]);

    try {
      if (!ACTION_WEBHOOK_URL) {
        throw new Error("Set NEXT_PUBLIC_ACTION_WEBHOOK_URL to launch one-click workflows.");
      }

      const response = await fetch(ACTION_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action_type: action.actionType,
          trigger_mode: "one_click",
          operator_name: profile.name,
          operator_email: profile.email,
          operator_department: profile.department,
          timestamp: new Date().toISOString(),
          preset_payload: action.payload,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(body || `Workflow returned ${response.status}`);
      }

      setRuns((prev) =>
        prev.map((run) =>
          run.id === runId
            ? {
                ...run,
                status: "completed",
                detail: action.outcome,
              }
            : run
        )
      );
      setBanner(`${action.title} launched successfully. ${action.outcome}`);
      setBannerTone("success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setRuns((prev) =>
        prev.map((run) =>
          run.id === runId
            ? {
                ...run,
                status: "failed",
                detail: message,
              }
            : run
        )
      );
      setBanner(`Could not run ${action.title}. ${message}`);
      setBannerTone("error");
    } finally {
      setActiveActionId(null);
    }
  }

  function saveProfile() {
    window.sessionStorage.setItem(
      "genio-automation-profile",
      JSON.stringify(draftProfile)
    );
    setProfile(draftProfile);
    setShowProfileGate(false);
  }

  return (
    <>
      {showProfileGate ? (
        <div className="profile-overlay">
          <div className="profile-panel">
            <div className="profile-kicker">Genio HR Automation</div>
            <h1>Launch autonomous HR workflows with one click</h1>
            <p>
              Set the operator profile once. After that, the platform runs timesheets,
              onboarding, wishes, and HR desk operations without asking users to type.
            </p>

            <div className="profile-grid">
              <label>
                Operator Name
                <input
                  value={draftProfile.name}
                  onChange={(event) =>
                    setDraftProfile((prev) => ({ ...prev, name: event.target.value }))
                  }
                />
              </label>
              <label>
                Work Email
                <input
                  type="email"
                  value={draftProfile.email}
                  onChange={(event) =>
                    setDraftProfile((prev) => ({ ...prev, email: event.target.value }))
                  }
                />
              </label>
              <label className="profile-span">
                Department
                <input
                  value={draftProfile.department}
                  onChange={(event) =>
                    setDraftProfile((prev) => ({
                      ...prev,
                      department: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <button className="primary-cta" onClick={saveProfile}>
              Enter Command Center
            </button>
          </div>
        </div>
      ) : null}

      <main className="dashboard-shell">
        <section className="hero-panel">
          <div>
            <p className="eyebrow">Autonomous People Ops Platform</p>
            <h1>One-click workflows for HR, timesheets, wishes, and onboarding</h1>
            <p className="hero-copy">
              This demo is now action-first. Every button triggers a full workflow with
              preset orchestration, notifications, and follow-ups.
            </p>
          </div>

          <div className="operator-card">
            <span className="operator-label">Operator</span>
            <strong>{profile.name}</strong>
            <span>{profile.email}</span>
            <span>{profile.department}</span>
          </div>
        </section>

        <section className="metrics-row">
          <article className="metric-card">
            <span>Ready Commands</span>
            <strong>{commandCount}</strong>
            <p>One-tap flows available for the demo.</p>
          </article>
          <article className="metric-card">
            <span>Active Runs</span>
            <strong>{activeRuns}</strong>
            <p>Workflows currently executing in the background.</p>
          </article>
          <article className="metric-card">
            <span>Completed Today</span>
            <strong>{completedRuns}</strong>
            <p>Finished automations visible to judges instantly.</p>
          </article>
        </section>

        {banner ? (
          <section className={`banner ${bannerTone}`}>
            <strong>{bannerTone === "success" ? "Workflow launched" : "Workflow failed"}</strong>
            <span>{banner}</span>
          </section>
        ) : null}

        <section className="content-grid">
          <div className="actions-column">
            {AUTOMATION_GROUPS.map((group) => (
              <section key={group.title} className="group-panel">
                <div className="group-head">
                  <div>
                    <p className="group-kicker">{group.title}</p>
                    <h2>{group.caption}</h2>
                  </div>
                </div>

                <div className="action-grid">
                  {group.actions.map((action) => {
                    const isRunning = activeActionId === action.id;

                    return (
                      <article key={action.id} className="action-card">
                        <div className="action-topline">
                          <span className="action-badge">{action.badge}</span>
                          <span className="action-eta">{action.eta}</span>
                        </div>
                        <h3>{action.title}</h3>
                        <p>{action.summary}</p>
                        <div className="action-meta">
                          <span>{action.team}</span>
                          <span>{action.outcome}</span>
                        </div>
                        <button
                          className="run-button"
                          onClick={() => triggerAction(action)}
                          disabled={isRunning}
                        >
                          {isRunning ? "Launching Workflow..." : "Run Workflow"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <aside className="side-column">
            <section className="rail-card">
              <p className="rail-kicker">Autonomy Logic</p>
              <h3>What each button already does</h3>
              <ul>
                <li>Creates the workflow payload with operator identity and presets.</li>
                <li>Triggers the downstream orchestration without opening a form.</li>
                <li>Updates the execution rail so the demo visibly feels autonomous.</li>
              </ul>
            </section>

            <section className="rail-card">
              <p className="rail-kicker">Execution Rail</p>
              <h3>Latest runs</h3>
              <div className="run-list">
                {runs.slice(0, 8).map((run) => (
                  <div key={run.id} className={`run-item ${run.status}`}>
                    <div className="run-head">
                      <strong>{run.title}</strong>
                      <span>{run.time}</span>
                    </div>
                    <p>{run.detail}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rail-card">
              <p className="rail-kicker">Best Demo Order</p>
              <h3>Use these three buttons first</h3>
              <ol>
                <li>Start New Joiner Onboarding</li>
                <li>Provision Access Pack</li>
                <li>Run Daily Timesheets</li>
              </ol>
            </section>
          </aside>
        </section>
      </main>
    </>
  );
}

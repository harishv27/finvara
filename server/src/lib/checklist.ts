import { get } from "../db.ts";
import { getProfile } from "./snapshot.ts";

export interface ChecklistItem { id: string; label: string; hint: string; done: boolean; link: string }

/** "Getting started" tasks, derived from what the user has actually done — never stale. */
export function checklistFor(userId: number): ChecklistItem[] {
  const p = getProfile(userId);
  const n = (sql: string) => get<{ n: number }>(sql, userId)!.n;
  return [
    { id: "profile", label: "Complete your profile", hint: "Income, age and goals tailor every number", done: !!p?.onboarded, link: "/profile" },
    { id: "risk", label: "Take the risk questionnaire", hint: "Six questions, about a minute", done: !!p?.risk_score, link: "/profile" },
    { id: "budget", label: "Set your monthly budget", hint: "Planned amounts power the alerts", done: n("SELECT COUNT(*) n FROM categories WHERE user_id = ? AND planned > 0") > 0, link: "/budget" },
    { id: "transaction", label: "Record a transaction", hint: "Or import a CSV from your bank", done: n("SELECT COUNT(*) n FROM transactions WHERE user_id = ?") > 0, link: "/budget" },
    { id: "goal", label: "Plan a goal", hint: "Home, education, or anything else", done: get<{ n: number }>("SELECT (SELECT COUNT(*) FROM milestones WHERE user_id = ?) + (SELECT COUNT(*) FROM savings_goals WHERE user_id = ?) n", userId, userId)!.n > 0, link: "/planner" },
    { id: "invest", label: "Explore funds or stocks", hint: "Add one to your watchlist", done: get<{ n: number }>("SELECT (SELECT COUNT(*) FROM holdings WHERE user_id = ?) + (SELECT COUNT(*) FROM watchlist WHERE user_id = ?) n", userId, userId)!.n > 0, link: "/funds" },
    { id: "advisor", label: "Ask an AI advisor", hint: "Try “Where is my money going?”", done: n("SELECT COUNT(*) n FROM conversations WHERE user_id = ?") > 0, link: "/chat" },
    { id: "will", label: "Start your will", hint: "Ten minutes, saved as you go", done: n("SELECT COUNT(*) n FROM wills WHERE user_id = ?") > 0, link: "/will" },
  ];
}

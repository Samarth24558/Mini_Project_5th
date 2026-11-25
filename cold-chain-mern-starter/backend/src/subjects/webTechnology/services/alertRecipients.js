export function getAlertRecipients({ assignedTeamEmail }) {
  const email = String(assignedTeamEmail || "").trim().toLowerCase();
  return email ? [email] : [];
}

import { Resend } from "resend";

let resendClient;

function getResend() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

export async function sendIncidentEmail({ to, subject, incident, shipment, team }) {
  if (!Array.isArray(to) || to.length === 0) {
    throw new Error("At least one email recipient is required");
  }

  const from = process.env.ALERT_FROM_EMAIL;
  if (!from) throw new Error("ALERT_FROM_EMAIL is not configured");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto">
      <h2>Cold-Chain Logistics Alert</h2>
      <p><strong>Incident:</strong> ${escapeHtml(incident.type)}</p>
      <p><strong>Severity:</strong> ${escapeHtml(incident.severity)}</p>
      <p><strong>Status:</strong> ${escapeHtml(incident.status)}</p>
      <p><strong>Shipment:</strong> ${escapeHtml(String(shipment?._id ?? "Unknown"))}</p>
      <p><strong>Route:</strong> ${escapeHtml(shipment?.origin ?? "Unknown")} → ${escapeHtml(shipment?.destination ?? "Unknown")}</p>
      <p><strong>Detected:</strong> ${new Date(incident.detectedAt).toISOString()}</p>
      <p><strong>Assigned team:</strong> ${escapeHtml(team?.teamName ?? "Unassigned")}</p>
      <p>${escapeHtml(incident.description ?? "")}</p>
      <p>Please sign in to the dashboard to acknowledge and manage this incident.</p>
    </div>
  `;

  const { data, error } = await getResend().emails.send({ from, to, subject, html });
  if (error) throw new Error(error.message || "Resend failed to send email");
  return data;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

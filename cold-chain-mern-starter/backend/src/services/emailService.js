import nodemailer from "nodemailer";

let transporter;

function getTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD must be configured");
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "")
      }
    });
  }
  return transporter;
}

function getFromAddress() {
  const from = process.env.ALERT_FROM_EMAIL || process.env.GMAIL_USER;
  if (!from) throw new Error("ALERT_FROM_EMAIL or GMAIL_USER must be configured");
  return from;
}

export async function sendIncidentEmail({ to, subject, incident, shipment, team }) {
  if (!Array.isArray(to) || to.length === 0) {
    throw new Error("At least one email recipient is required");
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto">
      <h2>Cold-Chain Logistics Alert</h2>
      <p><strong>Incident:</strong> ${escapeHtml(incident.type)}</p>
      <p><strong>Severity:</strong> ${escapeHtml(incident.severity)}</p>
      <p><strong>Status:</strong> ${escapeHtml(incident.status)}</p>
      <p><strong>Shipment:</strong> ${escapeHtml(String(shipment?._id ?? "Unknown"))}</p>
      <p><strong>Truck:</strong> ${escapeHtml(shipment?.truckId?.plateNo ?? "Unknown")} · ${escapeHtml(shipment?.truckId?.driverName ?? "Unknown driver")}</p>
      <p><strong>Route:</strong> ${escapeHtml(shipment?.origin ?? "Unknown")} → ${escapeHtml(shipment?.destination ?? "Unknown")}</p>
      <p><strong>Detected:</strong> ${new Date(incident.detectedAt).toISOString()}</p>
      <p><strong>Assigned team:</strong> ${escapeHtml(team?.teamName ?? "Unassigned")}</p>
      <p>${escapeHtml(incident.description ?? "")}</p>
      <p>Please sign in to the dashboard to acknowledge and manage this incident.</p>
    </div>
  `;

  return getTransporter().sendMail({ from: getFromAddress(), to, subject, html });
}

export async function sendRoleAssignmentEmail({ to, user }) {
  if (!Array.isArray(to) || to.length === 0) {
    throw new Error("At least one admin email recipient is required");
  }

  const dashboardUrl = process.env.CLIENT_URL || "http://localhost:5173";
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto">
      <h2>Role assignment required</h2>
      <p>A new ColdChainOps user has signed in and needs a role before full dashboard access is granted.</p>
      <p><strong>Name:</strong> ${escapeHtml(user.name || "Unknown user")}</p>
      <p><strong>Email:</strong> ${escapeHtml(user.email || "Unknown")}</p>
      <p><strong>Status:</strong> Waiting for fleet manager assignment</p>
      <p>Please open the dashboard and assign the correct role for this operator.</p>
      <p><a href="${escapeHtml(dashboardUrl)}">Open ColdChainOps</a></p>
    </div>
  `;

  return getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: "ColdChainOps: new user needs role assignment",
    html
  });
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

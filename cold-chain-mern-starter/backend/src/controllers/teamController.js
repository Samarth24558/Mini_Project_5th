import Team from "../models/Team.js";

export async function getTeams(_req, res) {
  try { const data = await Team.find().sort({ teamName: 1 }); res.json({ success: true, count: data.length, data }); }
  catch { res.status(500).json({ success: false, message: "Failed to load teams" }); }
}

export async function createTeam(req, res) {
  try {
    const { teamName, teamType = "general", description = "", email = "", phone = "" } = req.body;
    if (!teamName?.trim()) return res.status(400).json({ success: false, message: "Team name is required" });
    const team = await Team.create({ teamName: teamName.trim(), teamType, description, contactInfo: { email, phone } });
    res.status(201).json({ success: true, data: team });
  } catch (error) { res.status(error.code === 11000 ? 409 : 400).json({ success: false, message: error.code === 11000 ? "Team name already exists" : error.message }); }
}

export async function updateTeam(req, res) {
  try {
    const updates = {};
    for (const key of ["teamName", "teamType", "description", "status"]) if (Object.hasOwn(req.body, key)) updates[key] = req.body[key];
    if (req.body.email !== undefined) updates["contactInfo.email"] = req.body.email;
    if (req.body.phone !== undefined) updates["contactInfo.phone"] = req.body.phone;
    const team = await Team.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
    if (!team) return res.status(404).json({ success: false, message: "Team not found" });
    res.json({ success: true, data: team });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
}

import { SignedIn, SignedOut, SignInButton, UserButton, useAuth, useUser } from "@clerk/clerk-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const NAV = [
  ["overview", "Overview", "▦"], ["shipments", "Shipments", "⇄"], ["trucks", "Fleet", "▰"],
  ["monitoring", "Temperature & GPS", "⌁"], ["incidents", "Incidents", "⚑"],
  ["teams", "Response teams", "♧"], ["reports", "Reports & audit", "▤"]
];
const SHIPMENT_STATUSES = ["scheduled", "in_transit", "delayed", "delivered", "cancelled"];
const INCIDENT_STATUSES = ["new", "active", "acknowledged", "in_progress", "resolved", "closed"];

function csvRows(text, defaultShipmentId) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  const parse = line => {
    const values = [];
    let value = "", quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"' && quoted) { value += '"'; i += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { values.push(value.trim()); value = ""; }
      else value += char;
    }
    values.push(value.trim());
    return values;
  };
  if (lines.length < 2) return [];
  const headers = parse(lines[0]).map(value => value.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return lines.slice(1).map((line, index) => {
    const values = parse(line);
    const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
    const numeric = value => value == null || value === "" ? null : Number(value);
    const raw = Object.fromEntries(headers.map((header, i) => {
      const value = values[i] ?? "";
      return [header, value !== "" && Number.isFinite(Number(value)) ? Number(value) : value];
    }));
    return {
      shipmentId: row.shipmentid || row.shipment || row.shipmentobjectid || defaultShipmentId,
      timestamp: row.timestamp || row.recordedat || new Date(Date.now() + index).toISOString(),
      temperature: numeric(row.temperature ?? row.temperaturec ?? row.tempc),
      humidity: numeric(row.humidity ?? row.humiditypercent),
      doorStatus: row.doorstatus || "unknown",
      fuelLevel: numeric(row.fuellevel ?? row.fuellevelpercent),
      brakeStatus: row.brakestatus || "unknown",
      location: {
        latitude: numeric(row.latitude),
        longitude: numeric(row.longitude),
        label: row.location || (row.routedistancekm ? `Route distance ${row.routedistancekm} km` : "")
      },
      sourceData: raw,
      isSimulated: false
    };
  });
}

function Stat({ label, value, detail, tone = "" }) {
  return <article className="stat-card"><span className="stat-label">{label}</span><strong className={tone}>{value ?? "—"}</strong>{detail && <small>{detail}</small>}</article>;
}
function Pill({ children, kind = "neutral" }) { return <span className={`pill pill-${String(kind).toLowerCase().replaceAll("_", "-")}`}>{children}</span>; }
function Empty({ children = "Nothing to display yet." }) { return <div className="empty"><span>◌</span><p>{children}</p></div>; }
function TrendChart({ data, field, title, unit }) {
  const values = [...data].filter(x => Number.isFinite(x[field])).slice(0, 36).reverse();
  if (values.length < 2) return <div className="trend-card"><h4>{title}</h4><Empty>At least two readings are needed to draw a trend.</Empty></div>;
  const nums = values.map(x => Number(x[field]));
  const min = Math.min(...nums), max = Math.max(...nums), span = Math.max(max - min, 1);
  const points = nums.map((v, i) => `${18 + i * (264 / (nums.length - 1))},${100 - ((v - min) / span) * 78}`).join(" ");
  return <div className="trend-card"><div className="trend-head"><h4>{title}</h4><strong>{nums[nums.length - 1]}{unit}</strong></div><svg viewBox="0 0 300 118" role="img" aria-label={`${title} history chart`}><line x1="18" y1="22" x2="282" y2="22"/><line x1="18" y1="61" x2="282" y2="61"/><line x1="18" y1="100" x2="282" y2="100"/><polyline points={points}/>{nums.map((v,i)=><circle key={i} cx={18 + i * (264 / (nums.length - 1))} cy={100 - ((v - min) / span) * 78} r="2.5"/>)}</svg><div className="trend-range"><span>Min {min}{unit}</span><span>Max {max}{unit}</span></div></div>;
}

function Workspace() {
  const { getToken, isLoaded: authLoaded, isSignedIn } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const [section, setSection] = useState("overview");
  const [profile, setProfile] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [shipments, setShipments] = useState([]);
  const [trucks, setTrucks] = useState([]);
  const [telemetry, setTelemetry] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [audit, setAudit] = useState([]);
  const [teams, setTeams] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [latest, setLatest] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [datasetProgress, setDatasetProgress] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedShipment, setSelectedShipment] = useState("");
  const [isSimulating, setIsSimulating] = useState(false);
  const [tempForm, setTempForm] = useState({ temperature: "4.5", humidity: "65", doorStatus: "closed", fuelLevel: "82", brakeStatus: "normal", latitude: "", longitude: "" });
  const [shipmentForm, setShipmentForm] = useState({ truckId: "", origin: "", destination: "" });
  const [truckForm, setTruckForm] = useState({ driverName: "", plateNo: "", capacityKg: "" });
  const [teamForm, setTeamForm] = useState({ teamName: "", teamType: "cold_chain", email: "", phone: "", description: "" });
  const [incidentForm, setIncidentForm] = useState({ shipmentId: "", type: "other", severity: "medium", description: "" });
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");
  const simTimer = useRef(null);

  const request = useCallback(async (path, options = {}) => {
    const token = await getToken();
    if (!token) throw new Error("Your Clerk session token is unavailable. Sign out and sign in again.");
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
    });
    const contentType = response.headers.get("content-type") || "";
    const result = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) throw new Error(result?.message || `Request failed (${response.status})`);
    return result;
  }, [getToken]);

  const loadAll = useCallback(async () => {
    setBusy(true);
    try {
      const [d, s, t, l, i, a, tm, al, au, asg, p, u] = await Promise.all([
        request("/api/dashboard"), request("/api/shipments"), request("/api/trucks"), request("/api/telemetry?limit=100"),
        request("/api/incidents"), request("/api/telemetry/latest"), request("/api/teams"), request("/api/incidents/meta/alerts"),
        request("/api/incidents/meta/audit"), request("/api/incidents/meta/assignments"), request("/api/users/me"),
        request("/api/telemetry/uploads")
      ]);
      setDashboard(d.data); setShipments(s.data); setTrucks(t.data); setTelemetry(l.data); setIncidents(i.data); setLatest(a.data);
      setTeams(tm.data); setAlerts(al.data); setAudit(au.data); setAssignments(asg.data); setProfile(p.data);
      setUploads(u.data);
      setSelectedShipment(current => current || s.data[0]?._id || "");
      setShipmentForm(current => ({ ...current, truckId: current.truckId || t.data.find(x => x.status === "active")?._id || "" }));
    } catch (error) { setNotice({ type: "error", text: error.message }); }
    finally { setBusy(false); }
  }, [request]);

  useEffect(() => {
    if (!authLoaded || !userLoaded || !isSignedIn || !user) return;
    let active = true;
    (async () => {
      try {
        await request("/api/users/sync", { method: "POST", body: JSON.stringify({ name: user?.fullName || user?.firstName || "Fleet User", email: user?.primaryEmailAddress?.emailAddress || "" }) });
        if (active) await loadAll();
      } catch (error) { if (active) setNotice({ type: "error", text: error.message }); }
    })();
    return () => { active = false; };
  }, [authLoaded, userLoaded, isSignedIn, request, user, loadAll]);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("theme", theme); }, [theme]);
  useEffect(() => { if (!["overview", "monitoring", "incidents"].includes(section)) return; const timer = setInterval(() => loadAll(), 15000); return () => clearInterval(timer); }, [section, loadAll]);
  useEffect(() => {
    if (!profile?._id) return;
    const controller = new AbortController();
    let active = true;
    (async () => {
      try {
        const token = await getToken();
        const response = await fetch(`${API}/api/stream/telemetry`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok || !response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (active) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() || "";
          for (const chunk of chunks) if (chunk.includes("event: telemetry")) await loadAll();
        }
      } catch (error) { if (error.name !== "AbortError") console.warn("Telemetry live stream disconnected", error); }
    })();
    return () => { active = false; controller.abort(); };
  }, [profile?._id, getToken, loadAll]);
  useEffect(() => { if (notice.text) { const timer = setTimeout(() => setNotice({ type: "", text: "" }), 6000); return () => clearTimeout(timer); } }, [notice]);
  useEffect(() => () => { if (simTimer.current) clearInterval(simTimer.current); }, []);

  const flash = (text, type = "success") => setNotice({ text, type });
  const run = async fn => { setBusy(true); try { await fn(); } catch (error) { flash(error.message, "error"); } finally { setBusy(false); } };
  const createTruck = e => { e.preventDefault(); run(async () => { await request("/api/trucks", { method: "POST", body: JSON.stringify({ ...truckForm, capacityKg: Number(truckForm.capacityKg) }) }); setTruckForm({ driverName: "", plateNo: "", capacityKg: "" }); flash("Truck registered successfully"); await loadAll(); }); };
  const changeTruckStatus = (id, status) => run(async () => { await request(`/api/trucks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); flash("Truck status updated"); await loadAll(); });
  const createShipment = e => { e.preventDefault(); run(async () => { await request("/api/shipments", { method: "POST", body: JSON.stringify(shipmentForm) }); setShipmentForm(x => ({ ...x, origin: "", destination: "" })); flash("Shipment created successfully"); await loadAll(); }); };
  const changeShipmentStatus = (id, status) => run(async () => { await request(`/api/shipments/${id}`, { method: "PUT", body: JSON.stringify({ status }) }); flash("Shipment status updated"); await loadAll(); });

  const sendReading = useCallback(async (overrides = {}) => {
    if (!selectedShipment) throw new Error("Select a shipment first");
    const data = { shipmentId: selectedShipment, temperature: Number(tempForm.temperature), humidity: Number(tempForm.humidity), doorStatus: tempForm.doorStatus, fuelLevel: Number(tempForm.fuelLevel), brakeStatus: tempForm.brakeStatus, isSimulated: true, location: { latitude: tempForm.latitude === "" ? null : Number(tempForm.latitude), longitude: tempForm.longitude === "" ? null : Number(tempForm.longitude), label: "Sensor reading" }, ...overrides };
    await request("/api/telemetry", { method: "POST", body: JSON.stringify(data) });
    await loadAll();
  }, [request, selectedShipment, tempForm, loadAll]);
  const startSimulation = () => {
    if (!selectedShipment) return flash("Create or select a shipment first", "error");
    if (simTimer.current) clearInterval(simTimer.current);
    setIsSimulating(true);
    const push = async () => {
      try {
        const temp = Number((2 + Math.random() * 8).toFixed(1));
        const humidity = Math.round(55 + Math.random() * 25);
        const token = await getToken();
        await fetch(`${API}/api/telemetry`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ shipmentId: selectedShipment, temperature: temp, humidity, doorStatus: Math.random() > .95 ? "open" : "closed", fuelLevel: Math.round(40 + Math.random() * 55), brakeStatus: "normal", isSimulated: true }) });
        await loadAll();
      } catch (error) { flash(error.message, "error"); stopSimulation(); }
    };
    push(); simTimer.current = setInterval(push, 5000); flash("Sensor simulation started · new readings every 5 seconds");
  };
  const stopSimulation = () => { if (simTimer.current) clearInterval(simTimer.current); simTimer.current = null; setIsSimulating(false); };

  const createIncident = e => { e.preventDefault(); run(async () => { await request("/api/incidents", { method: "POST", body: JSON.stringify(incidentForm) }); setIncidentForm({ shipmentId: "", type: "other", severity: "medium", description: "" }); flash("Incident created"); await loadAll(); }); };
  const updateIncident = (id, status) => run(async () => { await request(`/api/incidents/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); flash("Incident updated"); await loadAll(); });
  const assignIncident = (id, teamId) => run(async () => { if (!teamId) return; await request(`/api/incidents/${id}/assign`, { method: "POST", body: JSON.stringify({ teamId, note: "Assigned from operations dashboard" }) }); flash("Response team assigned"); await loadAll(); });
  const createTeam = e => { e.preventDefault(); run(async () => { await request("/api/teams", { method: "POST", body: JSON.stringify(teamForm) }); setTeamForm({ teamName: "", teamType: "cold_chain", email: "", phone: "", description: "" }); flash("Response team created"); await loadAll(); }); };
  const simulateDataset = async upload => {
    setDatasetProgress({ fileName: upload.fileName, processed: upload.simulationProcessedRows, total: upload.validRows, status: "Simulation running" });
    try {
      let step;
      do {
        step = await request(`/api/telemetry/uploads/${upload._id}/simulate`, {
          method: "POST",
          body: JSON.stringify({ batchSize: 250 })
        });
        const progress = step.simulation;
        setDatasetProgress({
          fileName: upload.fileName,
          processed: progress.processedRows,
          total: progress.totalRows,
          status: step.complete ? "Simulation complete" : "Simulation running"
        });
        setUploads(current => current.map(item => item._id === upload._id ? {
          ...item,
          simulationProcessedRows: progress.processedRows,
          simulationStatus: step.complete ? "completed" : "running"
        } : item));
      } while (!step.complete);
      flash(`Dataset simulation complete · ${step.simulation.processedRows} rows replayed`);
      await loadAll();
    } catch (error) {
      setDatasetProgress(current => current ? { ...current, status: "Simulation failed" } : current);
      throw error;
    }
  };
  const importFile = e => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (file.size > 5 * 1024 * 1024) return flash("CSV files must be 5 MB or smaller", "error");
    run(async () => {
      setDatasetProgress({ fileName: file.name, processed: 0, total: 0, status: "Uploading dataset to MongoDB Atlas…" });
      try {
        if (!selectedShipment) throw new Error("Create or select a shipment before uploading this dataset");
        const rows = csvRows(await file.text(), selectedShipment);
        if (!rows.length) throw new Error("CSV has no data rows");
        if (rows.length > 10000) throw new Error("CSV datasets are limited to 10,000 rows");
        const result = await request("/api/telemetry/import", { method: "POST", body: JSON.stringify({ fileName: file.name, rows }) });
        const upload = result.data;
        if (!upload.validRows) throw new Error(upload.validationMessage || "No valid telemetry rows were found");
        setUploads(current => [upload, ...current.filter(item => item._id !== upload._id)]);
        await simulateDataset(upload);
      } catch (error) {
        setDatasetProgress(current => current ? { ...current, status: "Simulation failed" } : current);
        throw error;
      }
    });
  };
  const exportReport = async type => run(async () => { const token = await getToken(); const response = await fetch(`${API}/api/reports/export?type=${type}`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) { const e = await response.json(); throw new Error(e.message || "Export failed"); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `cold-chain-${type}-report.csv`; a.click(); URL.revokeObjectURL(url); flash("Report downloaded"); });

  const filteredShipments = useMemo(() => shipments.filter(s => `${s.origin} ${s.destination} ${s.truckId?.plateNo || ""}`.toLowerCase().includes(search.toLowerCase())), [shipments, search]);
  const openIncidents = incidents.filter(x => !["resolved", "closed"].includes(x.status));
  const canManage = ["fleet_manager", "admin"].includes(profile?.role);
  const minTemp = dashboard?.thresholds?.minTemp ?? 2;
  const maxTemp = dashboard?.thresholds?.maxTemp ?? 8;
  const currentShipment = shipments.find(x => x._id === selectedShipment);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon">CC</span><span>ColdChain<span className="brand-accent">Ops</span><small>LOGISTICS CONTROL</small></span></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav>{NAV.map(([id, label, icon]) => <button key={id} className={`nav-item ${section === id ? "active" : ""}`} onClick={() => setSection(id)}><span>{icon}</span>{label}{id === "incidents" && openIncidents.length > 0 && <i>{openIncidents.length}</i>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="connection"><span className="online-dot"/> API & database connected</div><div className="user-card"><div className="avatar">{(profile?.name || user?.firstName || "U").slice(0, 1).toUpperCase()}</div><div><strong>{profile?.name || user?.fullName || "Fleet user"}</strong><small>{profile?.role?.replaceAll("_", " ") || "Loading role"}</small></div><UserButton /></div></div>
    </aside>
    <main className="main-area">
      <header className="top-header"><div><div className="breadcrumb">COLDCHAIN OPS <span>/</span> {NAV.find(x => x[0] === section)?.[1].toUpperCase()}</div><h1>{NAV.find(x => x[0] === section)?.[1]}</h1></div><div className="header-actions"><span className="live-status"><i/> SYSTEM LIVE</span><button className="icon-button" onClick={() => setTheme(x => x === "light" ? "dark" : "light")} title="Toggle theme">◐</button><button className="button button-light" onClick={() => loadAll()} disabled={busy}>↻ Refresh</button></div></header>
      {notice.text && <div className={`toast ${notice.type}`}>{notice.type === "error" ? "!" : "✓"} {notice.text}<button onClick={() => setNotice({ type: "", text: "" })}>×</button></div>}
      {busy && <div className="loading-line"/>}
      {datasetProgress && <p className="helper-line">{datasetProgress.status}: {datasetProgress.fileName}{datasetProgress.total > 0 ? ` · ${datasetProgress.processed}/${datasetProgress.total} rows` : ""}</p>}

      {section === "overview" && <>
        <div className="welcome-row"><div><div className="eyebrow">OPERATIONS SNAPSHOT</div><h2>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, {profile?.name?.split(" ")[0] || "there"}</h2><p>Here's what's happening across your cold-chain fleet.</p></div><Pill kind="success">Monitoring active</Pill></div>
        <div className="stats-grid"><Stat label="TOTAL SHIPMENTS" value={dashboard?.totals?.shipments ?? 0} detail={`${dashboard?.shipmentStatuses?.find(x => x._id === "in_transit")?.count || 0} currently in transit`}/><Stat label="ACTIVE TRUCKS" value={trucks.filter(x => x.status === "active").length} detail={`${trucks.length} registered fleet vehicles`}/><Stat label="OPEN INCIDENTS" value={dashboard?.totals?.openIncidents ?? 0} tone={openIncidents.length ? "danger-text" : ""} detail="Require operational attention"/><Stat label="PENDING ALERTS" value={dashboard?.totals?.pendingAlerts ?? 0} detail="Dashboard / email delivery queue"/></div>
        <div className="content-grid"><section className="panel span-2"><div className="panel-heading"><div><h3>Recent incidents</h3><p>Latest detected and reported events</p></div><button className="text-link" onClick={() => setSection("incidents")}>View all →</button></div>{dashboard?.recentIncidents?.length ? <div className="list-rows">{dashboard.recentIncidents.map(x => <div className="list-row" key={x._id}><div className={`event-icon ${x.severity}`}>!</div><div className="row-main"><strong>{x.type.replaceAll("_", " ")}</strong><small>{x.shipmentId?.origin || "Shipment"} → {x.shipmentId?.destination || ""} · {new Date(x.detectedAt).toLocaleString()}</small></div><Pill kind={x.severity}>{x.severity}</Pill><Pill kind={x.status}>{x.status.replaceAll("_", " ")}</Pill></div>)}</div> : <Empty>No incidents detected. Your monitoring is clear.</Empty>}</section>
          <section className="panel"><div className="panel-heading"><div><h3>Shipment status</h3><p>Current distribution</p></div></div><div className="status-bars">{SHIPMENT_STATUSES.map(status => { const count = dashboard?.shipmentStatuses?.find(x => x._id === status)?.count || 0; const total = shipments.length || 1; return <div className="bar-item" key={status}><div><span>{status.replaceAll("_", " ")}</span><strong>{count}</strong></div><div className="bar-track"><i style={{ width: `${count / total * 100}%` }}/></div></div>; })}</div></section>
          <section className="panel span-3"><div className="panel-heading"><div><h3>Latest sensor activity</h3><p>Most recent telemetry across active shipments</p></div><button className="text-link" onClick={() => setSection("monitoring")}>Open monitoring →</button></div>{dashboard?.recentTelemetry?.length ? <div className="table-wrap"><table><thead><tr><th>SHIPMENT</th><th>TEMPERATURE</th><th>HUMIDITY</th><th>DOOR</th><th>RECORDED</th><th>SOURCE</th></tr></thead><tbody>{dashboard.recentTelemetry.map(x => <tr key={x._id}><td>{x.shipmentId?.origin} → {x.shipmentId?.destination}</td><td><strong>{x.temperature ?? "—"}°C</strong></td><td>{x.humidity ?? "—"}%</td><td><Pill kind={x.doorStatus}>{x.doorStatus}</Pill></td><td>{new Date(x.timestamp).toLocaleString()}</td><td>{x.isSimulated ? "Simulated" : "Device / import"}</td></tr>)}</tbody></table></div> : <Empty>Sensor data will appear here once readings are recorded.</Empty>}</section></div>
      </>}

      {section === "shipments" && <><div className="section-intro"><div><div className="eyebrow">TRANSPORT OPERATIONS</div><h2>Shipment management</h2><p>Create consignments, assign active trucks and update delivery progress.</p></div></div><div className="two-col"><section className="panel"><div className="panel-heading"><div><h3>Create shipment</h3><p>Assign a vehicle to a new route</p></div></div><form className="form-stack" onSubmit={createShipment}><label>Active truck<select required value={shipmentForm.truckId} onChange={e => setShipmentForm({ ...shipmentForm, truckId: e.target.value })}><option value="">Choose truck</option>{trucks.filter(x => x.status === "active").map(x => <option key={x._id} value={x._id}>{x.plateNo} · {x.driverName}</option>)}</select></label><label>Origin<input required value={shipmentForm.origin} onChange={e => setShipmentForm({ ...shipmentForm, origin: e.target.value })} placeholder="Warehouse / city"/></label><label>Destination<input required value={shipmentForm.destination} onChange={e => setShipmentForm({ ...shipmentForm, destination: e.target.value })} placeholder="Delivery location"/></label><button className="button button-primary" disabled={!canManage || busy || !trucks.some(x => x.status === "active")}>{canManage ? "Create shipment" : "Fleet manager access required"}</button></form></section><section className="panel"><div className="panel-heading"><div><h3>Shipment register</h3><p>{shipments.length} total records</p></div><input className="search-input" placeholder="Search route or truck" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="table-wrap"><table><thead><tr><th>ROUTE</th><th>TRUCK</th><th>STATUS</th></tr></thead><tbody>{filteredShipments.map(s => <tr key={s._id}><td><strong>{s.origin} → {s.destination}</strong><small className="subline">{s._id.slice(-8).toUpperCase()}</small></td><td>{s.truckId?.plateNo || "—"}<small className="subline">{s.truckId?.driverName || ""}</small></td><td><select className="compact-select" disabled={!canManage} value={s.status} onChange={e => changeShipmentStatus(s._id, e.target.value)}>{SHIPMENT_STATUSES.map(x => <option key={x} value={x}>{x.replaceAll("_", " ")}</option>)}</select></td></tr>)}</tbody></table>{!filteredShipments.length && <Empty>No shipments match your search.</Empty>}</div></section></div></>}

      {section === "trucks" && <><div className="section-intro"><div><div className="eyebrow">FLEET DIRECTORY</div><h2>Vehicle management</h2><p>Register refrigerated trucks and maintain fleet availability.</p></div></div><div className="two-col"><section className="panel"><div className="panel-heading"><div><h3>Register truck</h3><p>Add a vehicle to your fleet</p></div></div><form className="form-stack" onSubmit={createTruck}><label>Driver name<input required value={truckForm.driverName} onChange={e => setTruckForm({ ...truckForm, driverName: e.target.value })}/></label><label>Registration number<input required value={truckForm.plateNo} onChange={e => setTruckForm({ ...truckForm, plateNo: e.target.value.toUpperCase() })} placeholder="KA01AB1234"/></label><label>Capacity (kg)<input required type="number" min="1" value={truckForm.capacityKg} onChange={e => setTruckForm({ ...truckForm, capacityKg: e.target.value })}/></label><button className="button button-primary" disabled={!canManage || busy}>{canManage ? "Register vehicle" : "Fleet manager access required"}</button></form></section><section className="panel"><div className="panel-heading"><div><h3>Fleet register</h3><p>{trucks.length} registered vehicles</p></div></div><div className="table-wrap"><table><thead><tr><th>REGISTRATION</th><th>DRIVER</th><th>CAPACITY</th><th>STATUS</th></tr></thead><tbody>{trucks.map(t => <tr key={t._id}><td><strong>{t.plateNo}</strong></td><td>{t.driverName}</td><td>{Number(t.capacityKg).toLocaleString()} kg</td><td><select className="compact-select" disabled={!canManage} value={t.status} onChange={e => changeTruckStatus(t._id, e.target.value)}><option value="active">active</option><option value="inactive">inactive</option><option value="maintenance">maintenance</option></select></td></tr>)}</tbody></table>{!trucks.length && <Empty>No vehicles registered yet.</Empty>}</div></section></div></>}

      {section === "monitoring" && <><div className="section-intro"><div><div className="eyebrow">CONDITION INTELLIGENCE</div><h2>Temperature & GPS monitoring</h2><p>Track cold-chain conditions, review sensor history and replay simulated telemetry.</p></div><Pill kind="success">Target range: {minTemp}–{maxTemp}°C</Pill></div><div className="two-col monitor-grid"><section className="panel"><div className="panel-heading"><div><h3>Sensor console</h3><p>Choose a shipment and submit a test reading</p></div></div><div className="form-stack"><label>Shipment<select disabled={isSimulating} value={selectedShipment} onChange={e => setSelectedShipment(e.target.value)}><option value="">Select shipment</option>{shipments.map(s => <option key={s._id} value={s._id}>{s.origin} → {s.destination} · {s._id.slice(-6)}</option>)}</select></label><div className="form-row"><label>Temperature °C<input type="number" step="0.1" value={tempForm.temperature} onChange={e => setTempForm({ ...tempForm, temperature: e.target.value })}/></label><label>Humidity %<input type="number" min="0" max="100" value={tempForm.humidity} onChange={e => setTempForm({ ...tempForm, humidity: e.target.value })}/></label></div><div className="form-row"><label>Door status<select value={tempForm.doorStatus} onChange={e => setTempForm({ ...tempForm, doorStatus: e.target.value })}><option value="closed">Closed</option><option value="open">Open</option><option value="unknown">Unknown</option></select></label><label>Fuel %<input type="number" min="0" max="100" value={tempForm.fuelLevel} onChange={e => setTempForm({ ...tempForm, fuelLevel: e.target.value })}/></label></div><label>Brake status<select value={tempForm.brakeStatus} onChange={e => setTempForm({ ...tempForm, brakeStatus: e.target.value })}><option value="normal">Normal</option><option value="warning">Warning</option><option value="failure">Failure</option><option value="unknown">Unknown</option></select></label><div className="form-row"><label>GPS latitude<input type="number" step="any" value={tempForm.latitude} onChange={e => setTempForm({ ...tempForm, latitude: e.target.value })} placeholder="Optional"/></label><label>GPS longitude<input type="number" step="any" value={tempForm.longitude} onChange={e => setTempForm({ ...tempForm, longitude: e.target.value })} placeholder="Optional"/></label></div><button className="button button-primary" disabled={busy || !selectedShipment} onClick={() => run(async () => { await sendReading(); flash("Sensor reading saved and evaluated for incidents"); })}>＋ Submit reading</button><div className="simulator-box"><div><strong>Sensor simulator</strong><small>Generates randomized readings every 5 seconds.</small></div>{isSimulating ? <button className="button button-danger" onClick={stopSimulation}>Stop simulation</button> : <button className="button button-dark" onClick={startSimulation}>▶ Start demo sensor</button>}</div>{isSimulating && <p className="helper-line"><i className="pulse-dot"/> Simulator is running for the selected shipment.</p>}</div></section>
          <section className="panel"><div className="panel-heading"><div><h3>Latest shipment conditions</h3><p>Most recent sensor packet per shipment</p></div></div><div className="latest-list">{latest.map(x => <div className="latest-card" key={x._id}><div className="latest-top"><div><strong>{x.shipment?.origin || "Shipment"} → {x.shipment?.destination || ""}</strong><small>{x.shipment?.truckId?.plateNo || "Truck not assigned"}</small></div><Pill kind={x.temperature < minTemp || x.temperature > maxTemp ? "critical" : "success"}>{x.temperature < minTemp || x.temperature > maxTemp ? "Out of range" : "In range"}</Pill></div><div className="reading-values"><div><strong>{x.temperature ?? "—"}<small>°C</small></strong><span>Temperature</span></div><div><strong>{x.humidity ?? "—"}<small>%</small></strong><span>Humidity</span></div><div><strong>{x.fuelLevel ?? "—"}<small>%</small></strong><span>Fuel</span></div></div><small className="subline">{new Date(x.timestamp).toLocaleString()} · {x.isSimulated ? "Simulated" : "Device / import"}</small></div>)}{!latest.length && <Empty>No readings recorded. Submit a sensor reading to begin.</Empty>}</div></section></div>
          <section className="panel full-panel"><div className="panel-heading"><div><h3>Sensor trends</h3><p>Recent readings for the selected shipment · auto-refreshes every 15 seconds</p></div></div><div className="trend-grid"><TrendChart data={telemetry.filter(x => !selectedShipment || x.shipmentId?._id === selectedShipment)} field="temperature" title="Temperature trend" unit="°C"/><TrendChart data={telemetry.filter(x => !selectedShipment || x.shipmentId?._id === selectedShipment)} field="humidity" title="Humidity trend" unit="%"/></div></section>
          <section className="panel full-panel"><div className="panel-heading"><div><h3>Uploaded datasets & simulation</h3><p>CSV rows saved in MongoDB Atlas and replayed through incident detection</p></div><Pill kind="neutral">{uploads.length} datasets</Pill></div><div className="table-wrap"><table><thead><tr><th>DATASET</th><th>ROWS</th><th>SIMULATION</th><th>UPLOADED</th><th>ACTION</th></tr></thead><tbody>{uploads.map(upload => <tr key={upload._id}><td><strong>{upload.fileName}</strong></td><td>{upload.validRows} valid · {upload.rejectedRows} rejected</td><td><Pill kind={upload.simulationStatus}>{upload.simulationStatus.replaceAll("_", " ")}</Pill>{upload.simulationStatus !== "completed" && <small className="subline">{upload.simulationProcessedRows}/{upload.validRows} replayed</small>}</td><td>{new Date(upload.uploadTime).toLocaleString()}</td><td>{upload.simulationStatus !== "completed" && <button className="button button-dark" disabled={busy || !canManage} onClick={() => run(() => simulateDataset(upload))}>{upload.simulationProcessedRows ? "Continue simulation" : "Run simulation"}</button>}</td></tr>)}</tbody></table>{!uploads.length && <Empty>Upload a CSV dataset to save it to Atlas and run a simulation.</Empty>}</div></section>
          <section className="panel full-panel"><div className="panel-heading"><div><h3>Telemetry history & GPS positions</h3><p>Most recent 100 sensor readings</p></div><label className="upload-label">Upload CSV dataset<input type="file" accept=".csv,text/csv" onChange={importFile}/></label></div><div className="table-wrap"><table><thead><tr><th>TIME</th><th>SHIPMENT</th><th>TEMP</th><th>HUMIDITY</th><th>FUEL / BRAKES</th><th>GPS</th></tr></thead><tbody>{telemetry.slice(0, 100).map(x => <tr key={x._id}><td>{new Date(x.timestamp).toLocaleString()}</td><td>{x.shipmentId?.origin || ""} → {x.shipmentId?.destination || ""}</td><td><strong>{x.temperature ?? "—"}°C</strong></td><td>{x.humidity ?? "—"}%</td><td>{x.fuelLevel ?? "—"}% · {x.brakeStatus}</td><td>{x.location?.latitude != null && x.location?.longitude != null ? <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${x.location.latitude},${x.location.longitude}`}>{x.location.latitude.toFixed(4)}, {x.location.longitude.toFixed(4)} ↗</a> : "No GPS"}</td></tr>)}</tbody></table>{!telemetry.length && <Empty>Telemetry history will appear here.</Empty>}</div></section></>}

      {section === "incidents" && <><div className="section-intro"><div><div className="eyebrow">ALERT & RESPONSE CENTER</div><h2>Incident management</h2><p>Automatically detected breaches and manually reported events.</p></div><Pill kind={openIncidents.length ? "warning" : "success"}>{openIncidents.length} open incidents</Pill></div><div className="two-col"><section className="panel"><div className="panel-heading"><div><h3>Report an incident</h3><p>Create a manual operational event</p></div></div><form className="form-stack" onSubmit={createIncident}><label>Shipment<select required value={incidentForm.shipmentId} onChange={e => setIncidentForm({ ...incidentForm, shipmentId: e.target.value })}><option value="">Select shipment</option>{shipments.map(s => <option key={s._id} value={s._id}>{s.origin} → {s.destination}</option>)}</select></label><label>Incident type<select value={incidentForm.type} onChange={e => setIncidentForm({ ...incidentForm, type: e.target.value })}>{["temperature_breach", "door_open", "low_fuel", "accident", "brake_problem", "other"].map(x => <option key={x} value={x}>{x.replaceAll("_", " ")}</option>)}</select></label><label>Severity<select value={incidentForm.severity} onChange={e => setIncidentForm({ ...incidentForm, severity: e.target.value })}>{["low", "medium", "high", "critical"].map(x => <option key={x}>{x}</option>)}</select></label><label>Description<textarea required rows="3" value={incidentForm.description} onChange={e => setIncidentForm({ ...incidentForm, description: e.target.value })} placeholder="Describe what happened"/></label><button className="button button-primary" disabled={!canManage || busy || !shipments.length}>Create incident</button></form></section><section className="panel"><div className="panel-heading"><div><h3>Alert delivery log</h3><p>Dashboard and email notification events</p></div></div><div className="list-rows">{alerts.slice(0, 10).map(a => <div className="list-row" key={a._id}><div className="event-icon">✉</div><div className="row-main"><strong>{a.alertType.replaceAll("_", " ")}</strong><small>{a.message}</small></div><Pill kind={a.status}>{a.status}</Pill></div>)}{!alerts.length && <Empty>No alert events yet.</Empty>}</div></section></div><section className="panel full-panel"><div className="panel-heading"><div><h3>Incident register</h3><p>{incidents.length} total incidents · assign teams and update response status</p></div></div><div className="table-wrap"><table><thead><tr><th>EVENT</th><th>SHIPMENT</th><th>SEVERITY</th><th>ASSIGNED TEAM</th><th>STATUS</th><th>DETECTED</th></tr></thead><tbody>{incidents.map(x => <tr key={x._id}><td><strong>{x.type.replaceAll("_", " ")}</strong><small className="subline">{x.description}</small></td><td>{x.shipmentId?.origin} → {x.shipmentId?.destination}</td><td><Pill kind={x.severity}>{x.severity}</Pill></td><td><select className="compact-select" disabled={!canManage} value={x.assignedTeamId?._id || ""} onChange={e => assignIncident(x._id, e.target.value)}><option value="">Unassigned</option>{teams.map(t => <option key={t._id} value={t._id}>{t.teamName}</option>)}</select></td><td><select className="compact-select" disabled={!canManage && profile?.role !== "action_team_member"} value={x.status} onChange={e => updateIncident(x._id, e.target.value)}>{INCIDENT_STATUSES.map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></td><td>{new Date(x.detectedAt).toLocaleString()}</td></tr>)}</tbody></table>{!incidents.length && <Empty>No incidents to show.</Empty>}</div></section></>}

      {section === "teams" && <><div className="section-intro"><div><div className="eyebrow">RESPONSE COORDINATION</div><h2>Response teams</h2><p>Manage specialist teams and view incident assignment history.</p></div></div><div className="two-col"><section className="panel"><div className="panel-heading"><div><h3>Create response team</h3><p>Set up a routing destination for incidents</p></div></div><form className="form-stack" onSubmit={createTeam}><label>Team name<input required value={teamForm.teamName} onChange={e => setTeamForm({ ...teamForm, teamName: e.target.value })}/></label><label>Team type<select value={teamForm.teamType} onChange={e => setTeamForm({ ...teamForm, teamType: e.target.value })}>{["cold_chain", "fuel_support", "emergency_response", "maintenance", "general"].map(x => <option key={x} value={x}>{x.replaceAll("_", " ")}</option>)}</select></label><label>Contact email<input type="email" value={teamForm.email} onChange={e => setTeamForm({ ...teamForm, email: e.target.value })}/></label><label>Contact phone<input value={teamForm.phone} onChange={e => setTeamForm({ ...teamForm, phone: e.target.value })}/></label><label>Description<textarea rows="2" value={teamForm.description} onChange={e => setTeamForm({ ...teamForm, description: e.target.value })}/></label><button className="button button-primary" disabled={!canManage || busy}>Create team</button></form></section><section className="panel"><div className="panel-heading"><div><h3>Team directory</h3><p>{teams.length} registered response teams</p></div></div><div className="team-grid">{teams.map(t => <article className="team-card" key={t._id}><div className="team-symbol">♧</div><div><strong>{t.teamName}</strong><small>{t.teamType.replaceAll("_", " ")}</small><p>{t.description || "No description provided."}</p><small>{t.contactInfo?.email || "No email configured"}</small></div><Pill kind={t.status}>{t.status}</Pill></article>)}{!teams.length && <Empty>No response teams configured.</Empty>}</div></section></div><section className="panel full-panel"><div className="panel-heading"><div><h3>Assignment history</h3><p>Incident routing and reassignment records</p></div></div><div className="table-wrap"><table><thead><tr><th>INCIDENT</th><th>TEAM</th><th>ROLE</th><th>STATUS</th><th>ASSIGNED</th></tr></thead><tbody>{assignments.map(a => <tr key={a._id}><td>{a.incidentId?.type?.replaceAll("_", " ") || "Incident"}</td><td>{a.teamId?.teamName || "—"}</td><td>{a.role}</td><td><Pill kind={a.status}>{a.status}</Pill></td><td>{new Date(a.assignedAt).toLocaleString()}</td></tr>)}</tbody></table>{!assignments.length && <Empty>No assignment history yet.</Empty>}</div></section></>}

      {section === "reports" && <><div className="section-intro"><div><div className="eyebrow">COMPLIANCE & TRACEABILITY</div><h2>Reports & audit trail</h2><p>Export operational records and review changes to incident handling.</p></div></div><div className="report-grid"><article className="report-card"><div className="report-icon">⌁</div><h3>Telemetry report</h3><p>Temperature, humidity, door, fuel, brake and GPS readings.</p><button className="button button-primary" onClick={() => exportReport("telemetry")}>↓ Export CSV</button></article><article className="report-card"><div className="report-icon">⚑</div><h3>Incident report</h3><p>Incident type, severity, response status and assigned team.</p><button className="button button-primary" onClick={() => exportReport("incidents")}>↓ Export CSV</button></article><article className="report-card"><div className="report-icon">⇄</div><h3>Shipment report</h3><p>Shipment routes, truck assignment and delivery milestones.</p><button className="button button-primary" onClick={() => exportReport("shipments")}>↓ Export CSV</button></article></div><section className="panel full-panel"><div className="panel-heading"><div><h3>Audit log</h3><p>Traceable record of incident detection and response actions</p></div><Pill kind="neutral">{audit.length} entries</Pill></div><div className="table-wrap"><table><thead><tr><th>ACTION</th><th>INCIDENT</th><th>REMARKS</th><th>TIME</th></tr></thead><tbody>{audit.map(x => <tr key={x._id}><td><strong>{x.action.replaceAll("_", " ")}</strong></td><td>{x.incidentId?.type?.replaceAll("_", " ") || "—"}</td><td>{x.remarks}</td><td>{new Date(x.actionTime).toLocaleString()}</td></tr>)}</tbody></table>{!audit.length && <Empty>Audit entries will appear as incidents are created and managed.</Empty>}</div></section></>}
      <footer className="app-footer">ColdChain Ops · Operational monitoring workspace <span>Role: {profile?.role?.replaceAll("_", " ") || "—"}</span></footer>
    </main>
  </div>;
}

export default function App() {
  const [apiStatus, setApiStatus] = useState("Checking API connection…");
  useEffect(() => { fetch(`${API}/api/health`).then(r => r.json()).then(d => setApiStatus(d.database === "connected" ? "API & MongoDB connected" : "API online · database disconnected")).catch(() => setApiStatus("API unavailable · start backend")); }, []);
  return <><SignedIn><Workspace/></SignedIn><SignedOut><main className="login-page"><div className="login-card"><div className="brand login-brand"><span className="brand-icon">CC</span><span>ColdChain<span className="brand-accent">Ops</span><small>LOGISTICS CONTROL</small></span></div><div className="eyebrow">COLD-CHAIN INTELLIGENCE PLATFORM</div><h1>Protect every shipment.<br/><em>Every degree matters.</em></h1><p>Monitor refrigerated freight, track sensor conditions, detect temperature excursions and coordinate response teams from one operations workspace.</p><div className="login-status"><i className={apiStatus.includes("connected") ? "" : "offline"}/>{apiStatus}</div><SignInButton mode="modal"><button className="button button-primary login-button">Sign in to workspace <span>→</span></button></SignInButton><div className="login-features"><span>Temperature monitoring</span><span>GPS visibility</span><span>Incident response</span></div></div><div className="login-footer">COLDCHAIN OPS · FLEET MONITORING & RESPONSE</div></main></SignedOut></>;
}

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { apiUrl } from "../config/api";
import { readStoredSession } from "../utils/sessionCleanup";
import "./patientInstantiation.css";

const COUNTRY_CODES = [
  { code: "+93",  label: "🇦🇫 Afghanistan (+93)" },
  { code: "+355", label: "🇦🇱 Albania (+355)" },
  { code: "+213", label: "🇩🇿 Algeria (+213)" },
  { code: "+1",   label: "🇺🇸 USA / Canada (+1)" },
  { code: "+376", label: "🇦🇩 Andorra (+376)" },
  { code: "+244", label: "🇦🇴 Angola (+244)" },
  { code: "+1268",label: "🇦🇬 Antigua (+1268)" },
  { code: "+54",  label: "🇦🇷 Argentina (+54)" },
  { code: "+374", label: "🇦🇲 Armenia (+374)" },
  { code: "+61",  label: "🇦🇺 Australia (+61)" },
  { code: "+43",  label: "🇦🇹 Austria (+43)" },
  { code: "+994", label: "🇦🇿 Azerbaijan (+994)" },
  { code: "+1242",label: "🇧🇸 Bahamas (+1242)" },
  { code: "+973", label: "🇧🇭 Bahrain (+973)" },
  { code: "+880", label: "🇧🇩 Bangladesh (+880)" },
  { code: "+1246",label: "🇧🇧 Barbados (+1246)" },
  { code: "+375", label: "🇧🇾 Belarus (+375)" },
  { code: "+32",  label: "🇧🇪 Belgium (+32)" },
  { code: "+501", label: "🇧🇿 Belize (+501)" },
  { code: "+229", label: "🇧🇯 Benin (+229)" },
  { code: "+975", label: "🇧🇹 Bhutan (+975)" },
  { code: "+591", label: "🇧🇴 Bolivia (+591)" },
  { code: "+387", label: "🇧🇦 Bosnia (+387)" },
  { code: "+267", label: "🇧🇼 Botswana (+267)" },
  { code: "+55",  label: "🇧🇷 Brazil (+55)" },
  { code: "+673", label: "🇧🇳 Brunei (+673)" },
  { code: "+359", label: "🇧🇬 Bulgaria (+359)" },
  { code: "+226", label: "🇧🇫 Burkina Faso (+226)" },
  { code: "+257", label: "🇧🇮 Burundi (+257)" },
  { code: "+855", label: "🇰🇭 Cambodia (+855)" },
  { code: "+237", label: "🇨🇲 Cameroon (+237)" },
  { code: "+238", label: "🇨🇻 Cape Verde (+238)" },
  { code: "+236", label: "🇨🇫 Central African Rep. (+236)" },
  { code: "+235", label: "🇹🇩 Chad (+235)" },
  { code: "+56",  label: "🇨🇱 Chile (+56)" },
  { code: "+86",  label: "🇨🇳 China (+86)" },
  { code: "+57",  label: "🇨🇴 Colombia (+57)" },
  { code: "+269", label: "🇰🇲 Comoros (+269)" },
  { code: "+242", label: "🇨🇬 Congo (+242)" },
  { code: "+243", label: "🇨🇩 Congo DRC (+243)" },
  { code: "+506", label: "🇨🇷 Costa Rica (+506)" },
  { code: "+385", label: "🇭🇷 Croatia (+385)" },
  { code: "+53",  label: "🇨🇺 Cuba (+53)" },
  { code: "+357", label: "🇨🇾 Cyprus (+357)" },
  { code: "+420", label: "🇨🇿 Czech Republic (+420)" },
  { code: "+45",  label: "🇩🇰 Denmark (+45)" },
  { code: "+253", label: "🇩🇯 Djibouti (+253)" },
  { code: "+1767",label: "🇩🇲 Dominica (+1767)" },
  { code: "+1809",label: "🇩🇴 Dominican Republic (+1809)" },
  { code: "+593", label: "🇪🇨 Ecuador (+593)" },
  { code: "+20",  label: "🇪🇬 Egypt (+20)" },
  { code: "+503", label: "🇸🇻 El Salvador (+503)" },
  { code: "+240", label: "🇬🇶 Equatorial Guinea (+240)" },
  { code: "+291", label: "🇪🇷 Eritrea (+291)" },
  { code: "+372", label: "🇪🇪 Estonia (+372)" },
  { code: "+268", label: "🇸🇿 Eswatini (+268)" },
  { code: "+251", label: "🇪🇹 Ethiopia (+251)" },
  { code: "+679", label: "🇫🇯 Fiji (+679)" },
  { code: "+358", label: "🇫🇮 Finland (+358)" },
  { code: "+33",  label: "🇫🇷 France (+33)" },
  { code: "+241", label: "🇬🇦 Gabon (+241)" },
  { code: "+220", label: "🇬🇲 Gambia (+220)" },
  { code: "+995", label: "🇬🇪 Georgia (+995)" },
  { code: "+49",  label: "🇩🇪 Germany (+49)" },
  { code: "+233", label: "🇬🇭 Ghana (+233)" },
  { code: "+30",  label: "🇬🇷 Greece (+30)" },
  { code: "+1473",label: "🇬🇩 Grenada (+1473)" },
  { code: "+502", label: "🇬🇹 Guatemala (+502)" },
  { code: "+224", label: "🇬🇳 Guinea (+224)" },
  { code: "+245", label: "🇬🇼 Guinea-Bissau (+245)" },
  { code: "+592", label: "🇬🇾 Guyana (+592)" },
  { code: "+509", label: "🇭🇹 Haiti (+509)" },
  { code: "+504", label: "🇭🇳 Honduras (+504)" },
  { code: "+36",  label: "🇭🇺 Hungary (+36)" },
  { code: "+354", label: "🇮🇸 Iceland (+354)" },
  { code: "+91",  label: "🇮🇳 India (+91)" },
  { code: "+62",  label: "🇮🇩 Indonesia (+62)" },
  { code: "+98",  label: "🇮🇷 Iran (+98)" },
  { code: "+964", label: "🇮🇶 Iraq (+964)" },
  { code: "+353", label: "🇮🇪 Ireland (+353)" },
  { code: "+972", label: "🇮🇱 Israel (+972)" },
  { code: "+39",  label: "🇮🇹 Italy (+39)" },
  { code: "+225", label: "🇨🇮 Ivory Coast (+225)" },
  { code: "+1876",label: "🇯🇲 Jamaica (+1876)" },
  { code: "+81",  label: "🇯🇵 Japan (+81)" },
  { code: "+962", label: "🇯🇴 Jordan (+962)" },
  { code: "+7",   label: "🇰🇿 Kazakhstan (+7)" },
  { code: "+254", label: "🇰🇪 Kenya (+254)" },
  { code: "+686", label: "🇰🇮 Kiribati (+686)" },
  { code: "+965", label: "🇰🇼 Kuwait (+965)" },
  { code: "+996", label: "🇰🇬 Kyrgyzstan (+996)" },
  { code: "+856", label: "🇱🇦 Laos (+856)" },
  { code: "+371", label: "🇱🇻 Latvia (+371)" },
  { code: "+961", label: "🇱🇧 Lebanon (+961)" },
  { code: "+266", label: "🇱🇸 Lesotho (+266)" },
  { code: "+231", label: "🇱🇷 Liberia (+231)" },
  { code: "+218", label: "🇱🇾 Libya (+218)" },
  { code: "+423", label: "🇱🇮 Liechtenstein (+423)" },
  { code: "+370", label: "🇱🇹 Lithuania (+370)" },
  { code: "+352", label: "🇱🇺 Luxembourg (+352)" },
  { code: "+261", label: "🇲🇬 Madagascar (+261)" },
  { code: "+265", label: "🇲🇼 Malawi (+265)" },
  { code: "+60",  label: "🇲🇾 Malaysia (+60)" },
  { code: "+960", label: "🇲🇻 Maldives (+960)" },
  { code: "+223", label: "🇲🇱 Mali (+223)" },
  { code: "+356", label: "🇲🇹 Malta (+356)" },
  { code: "+692", label: "🇲🇭 Marshall Islands (+692)" },
  { code: "+222", label: "🇲🇷 Mauritania (+222)" },
  { code: "+230", label: "🇲🇺 Mauritius (+230)" },
  { code: "+52",  label: "🇲🇽 Mexico (+52)" },
  { code: "+691", label: "🇫🇲 Micronesia (+691)" },
  { code: "+373", label: "🇲🇩 Moldova (+373)" },
  { code: "+377", label: "🇲🇨 Monaco (+377)" },
  { code: "+976", label: "🇲🇳 Mongolia (+976)" },
  { code: "+382", label: "🇲🇪 Montenegro (+382)" },
  { code: "+212", label: "🇲🇦 Morocco (+212)" },
  { code: "+258", label: "🇲🇿 Mozambique (+258)" },
  { code: "+264", label: "🇳🇦 Namibia (+264)" },
  { code: "+674", label: "🇳🇷 Nauru (+674)" },
  { code: "+977", label: "🇳🇵 Nepal (+977)" },
  { code: "+64",  label: "🇳🇿 New Zealand (+64)" },
  { code: "+505", label: "🇳🇮 Nicaragua (+505)" },
  { code: "+227", label: "🇳🇪 Niger (+227)" },
  { code: "+234", label: "🇳🇬 Nigeria (+234)" },
  { code: "+850", label: "🇰🇵 North Korea (+850)" },
  { code: "+389", label: "🇲🇰 North Macedonia (+389)" },
  { code: "+47",  label: "🇳🇴 Norway (+47)" },
  { code: "+968", label: "🇴🇲 Oman (+968)" },
  { code: "+92",  label: "🇵🇰 Pakistan (+92)" },
  { code: "+680", label: "🇵🇼 Palau (+680)" },
  { code: "+970", label: "🇵🇸 Palestine (+970)" },
  { code: "+507", label: "🇵🇦 Panama (+507)" },
  { code: "+675", label: "🇵🇬 Papua New Guinea (+675)" },
  { code: "+595", label: "🇵🇾 Paraguay (+595)" },
  { code: "+51",  label: "🇵🇪 Peru (+51)" },
  { code: "+63",  label: "🇵🇭 Philippines (+63)" },
  { code: "+48",  label: "🇵🇱 Poland (+48)" },
  { code: "+351", label: "🇵🇹 Portugal (+351)" },
  { code: "+974", label: "🇶🇦 Qatar (+974)" },
  { code: "+40",  label: "🇷🇴 Romania (+40)" },
  { code: "+7",   label: "🇷🇺 Russia (+7)" },
  { code: "+250", label: "🇷🇼 Rwanda (+250)" },
  { code: "+1869",label: "🇰🇳 Saint Kitts & Nevis (+1869)" },
  { code: "+1758",label: "🇱🇨 Saint Lucia (+1758)" },
  { code: "+1784",label: "🇻🇨 Saint Vincent (+1784)" },
  { code: "+685", label: "🇼🇸 Samoa (+685)" },
  { code: "+378", label: "🇸🇲 San Marino (+378)" },
  { code: "+239", label: "🇸🇹 São Tomé (+239)" },
  { code: "+966", label: "🇸🇦 Saudi Arabia (+966)" },
  { code: "+221", label: "🇸🇳 Senegal (+221)" },
  { code: "+381", label: "🇷🇸 Serbia (+381)" },
  { code: "+248", label: "🇸🇨 Seychelles (+248)" },
  { code: "+232", label: "🇸🇱 Sierra Leone (+232)" },
  { code: "+65",  label: "🇸🇬 Singapore (+65)" },
  { code: "+421", label: "🇸🇰 Slovakia (+421)" },
  { code: "+386", label: "🇸🇮 Slovenia (+386)" },
  { code: "+677", label: "🇸🇧 Solomon Islands (+677)" },
  { code: "+252", label: "🇸🇴 Somalia (+252)" },
  { code: "+27",  label: "🇿🇦 South Africa (+27)" },
  { code: "+82",  label: "🇰🇷 South Korea (+82)" },
  { code: "+211", label: "🇸🇸 South Sudan (+211)" },
  { code: "+34",  label: "🇪🇸 Spain (+34)" },
  { code: "+94",  label: "🇱🇰 Sri Lanka (+94)" },
  { code: "+249", label: "🇸🇩 Sudan (+249)" },
  { code: "+597", label: "🇸🇷 Suriname (+597)" },
  { code: "+46",  label: "🇸🇪 Sweden (+46)" },
  { code: "+41",  label: "🇨🇭 Switzerland (+41)" },
  { code: "+963", label: "🇸🇾 Syria (+963)" },
  { code: "+886", label: "🇹🇼 Taiwan (+886)" },
  { code: "+992", label: "🇹🇯 Tajikistan (+992)" },
  { code: "+255", label: "🇹🇿 Tanzania (+255)" },
  { code: "+66",  label: "🇹🇭 Thailand (+66)" },
  { code: "+228", label: "🇹🇬 Togo (+228)" },
  { code: "+676", label: "🇹🇴 Tonga (+676)" },
  { code: "+1868",label: "🇹🇹 Trinidad & Tobago (+1868)" },
  { code: "+216", label: "🇹🇳 Tunisia (+216)" },
  { code: "+90",  label: "🇹🇷 Turkey (+90)" },
  { code: "+993", label: "🇹🇲 Turkmenistan (+993)" },
  { code: "+688", label: "🇹🇻 Tuvalu (+688)" },
  { code: "+256", label: "🇺🇬 Uganda (+256)" },
  { code: "+380", label: "🇺🇦 Ukraine (+380)" },
  { code: "+971", label: "🇦🇪 UAE (+971)" },
  { code: "+44",  label: "🇬🇧 United Kingdom (+44)" },
  { code: "+598", label: "🇺🇾 Uruguay (+598)" },
  { code: "+998", label: "🇺🇿 Uzbekistan (+998)" },
  { code: "+678", label: "🇻🇺 Vanuatu (+678)" },
  { code: "+58",  label: "🇻🇪 Venezuela (+58)" },
  { code: "+84",  label: "🇻🇳 Vietnam (+84)" },
  { code: "+967", label: "🇾🇪 Yemen (+967)" },
  { code: "+260", label: "🇿🇲 Zambia (+260)" },
  { code: "+263", label: "🇿🇼 Zimbabwe (+263)" },
];

const NATIONALITIES = [
  "Afghan","Albanian","Algerian","American","Andorran","Angolan","Antiguan","Argentine",
  "Armenian","Australian","Austrian","Azerbaijani","Bahamian","Bahraini","Bangladeshi",
  "Barbadian","Belarusian","Belgian","Belizean","Beninese","Bhutanese","Bolivian",
  "Bosnian","Botswanan","Brazilian","British","Bruneian","Bulgarian","Burkinabe",
  "Burundian","Cambodian","Cameroonian","Canadian","Cape Verdean","Central African",
  "Chadian","Chilean","Chinese","Colombian","Comorian","Congolese (Congo-Brazzaville)",
  "Congolese (DRC)","Costa Rican","Croatian","Cuban","Cypriot","Czech","Danish",
  "Djiboutian","Dominican","Dominican (Republic)","Dutch","East Timorese","Ecuadorean",
  "Egyptian","Emirati","Equatorial Guinean","Eritrean","Estonian","Eswatini","Ethiopian",
  "Fijian","Finnish","French","Gabonese","Gambian","Georgian","German","Ghanaian",
  "Greek","Grenadian","Guatemalan","Guinean","Guinea-Bissauan","Guyanese","Haitian",
  "Honduran","Hungarian","Icelandic","Indian","Indonesian","Iranian","Iraqi","Irish",
  "Israeli","Italian","Ivorian","Jamaican","Japanese","Jordanian","Kazakhstani",
  "Kenyan","Kiribati","Kuwaiti","Kyrgyz","Laotian","Latvian","Lebanese","Lesothan",
  "Liberian","Libyan","Liechtensteiner","Lithuanian","Luxembourgish","Malagasy",
  "Malawian","Malaysian","Maldivian","Malian","Maltese","Marshallese","Mauritanian",
  "Mauritian","Mexican","Micronesian","Moldovan","Monacan","Mongolian","Montenegrin",
  "Moroccan","Mozambican","Namibian","Nauruan","Nepalese","New Zealander","Nicaraguan",
  "Nigerien","Nigerian","North Korean","North Macedonian","Norwegian","Omani",
  "Pakistani","Palauan","Palestinian","Panamanian","Papua New Guinean","Paraguayan",
  "Peruvian","Philippine","Polish","Portuguese","Qatari","Romanian","Russian",
  "Rwandan","Saint Kitts and Nevis","Saint Lucian","Saint Vincentian","Salvadoran",
  "Samoan","San Marinese","São Toméan","Saudi","Senegalese","Serbian","Seychellois",
  "Sierra Leonean","Singaporean","Slovak","Slovenian","Solomon Islander","Somali",
  "South African","South Korean","South Sudanese","Spanish","Sri Lankan","Sudanese",
  "Surinamese","Swedish","Swiss","Syrian","Taiwanese","Tajik","Tanzanian","Thai",
  "Togolese","Tongan","Trinidadian","Tunisian","Turkish","Tuvaluan","Ugandan",
  "Ukrainian","Uruguayan","Uzbek","Vanuatuan","Venezuelan","Vietnamese","Yemeni",
  "Zambian","Zimbabwean",
];

const authHeader = () => {
  const token = readStoredSession()?.token || "";
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
};

const EMPTY_PERSONAL = {
  firstName: "", lastName: "", dateOfBirth: "", gender: "",
  nationality: "", phoneCode: "+1", phoneNumber: "", email: "",
  street: "", apartment: "", city: "", state: "", postalCode: "", country: "",
  occupation: "", maritalStatus: "",
  currentMood: "", character: "",
};

const EMPTY_CLINICAL = {
  chiefComplaint: "", historyOfPresentIllness: "", pastMedicalHistory: "",
  familyHistory: "", socialHistory: "", bloodType: "", allergies: "",
  chronicConditions: "", currentMedications: "",
  vitalSigns: { height: "", weight: "", bloodPressure: "", heartRate: "", temperature: "", oxygenSaturation: "" },
};

const PhoneCodeSelect = ({ value, onChange }) => {
  const [open, setOpen]       = useState(false);
  const [search, setSearch]   = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const getFlag = (label) => label.match(/^\S+/)?.[0] ?? "";
  const getName = (label) => label.replace(/^\S+\s/, "").replace(/\s*\(\+[\d]+\)$/, "");

  const filtered = search.trim()
    ? COUNTRY_CODES.filter(c =>
        c.label.toLowerCase().includes(search.toLowerCase()) ||
        c.code.includes(search)
      )
    : COUNTRY_CODES;

  const selected = COUNTRY_CODES.find(c => c.code === value) ?? COUNTRY_CODES[0];

  return (
    <div className="pi_cc_root" ref={rootRef}>
      <button
        type="button"
        className="pi_field_input pi_cc_trigger"
        onClick={() => { setOpen(o => !o); setSearch(""); }}
      >
        {getFlag(selected.label)} {selected.code}
      </button>

      {open && (
        <div className="pi_cc_dropdown">
          <input
            className="pi_cc_search"
            placeholder="Search country…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <div className="pi_cc_list">
            {filtered.map(c => (
              <button
                key={c.label}
                type="button"
                className={`pi_cc_option${c.code === value ? " pi_cc_option--active" : ""}`}
                onClick={() => { onChange(c.code); setOpen(false); }}
              >
                <span className="pi_cc_flag">{getFlag(c.label)}</span>
                <span className="pi_cc_name">{getName(c.label)}</span>
                <span className="pi_cc_code">{c.code}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="pi_cc_empty">No results</p>}
          </div>
        </div>
      )}
    </div>
  );
};

// Duration for the Call Log list/detail — endedAt is null while a call is
// still "in-progress", so that reads as "ongoing" rather than a bogus 0:00.
const formatCallDuration = (call) => {
  if (!call?.startedAt) return "";
  if (!call.endedAt) return "ongoing";
  const seconds = Math.max(0, Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const Field = ({ label, value, onChange, type = "text", textarea }) => (
  <div className="pi_field">
    <label className="pi_field_label">{label}</label>
    {textarea
      ? <textarea className="pi_field_input pi_field_textarea" value={value} onChange={e => onChange(e.target.value)} rows={3} />
      : <input className="pi_field_input" type={type} value={value} onChange={e => onChange(e.target.value)} />
    }
  </div>
);

const PatientInstantiationPage = () => {
  const navigate = useNavigate();
  const userId   = readStoredSession()?.my_id;

  const [patients,       setPatients]       = useState([]);
  const [selected,       setSelected]       = useState(null);
  const [tab,            setTab]            = useState("personal");
  const [personal,       setPersonal]       = useState(EMPTY_PERSONAL);
  const [clinical,       setClinical]       = useState(EMPTY_CLINICAL);
  const [saving,         setSaving]         = useState(false);
  const [deleting,       setDeleting]       = useState(false);
  const [status,         setStatus]         = useState("");
  const [isNew,          setIsNew]          = useState(false);
  const [receivedMorphe, setReceivedMorphe] = useState(null);

  // Patients Call Log — read-only. Each call is linked to the patient's own
  // Patient instance (populated as call.patientId; see
  // back/routes/PatientCallLogAPI.js), which the patient-side voice call
  // collects into directly — editing still only happens via the Patients
  // tab/PatientAPI.js, never from here.
  const [mode,        setMode]        = useState("patients"); // "patients" | "calls" | "unclaimed"
  const [calls,        setCalls]        = useState([]);
  const [callsLoading, setCallsLoading] = useState(false);
  const [selectedCall, setSelectedCall] = useState(null);

  // Unclaimed queue — self-registered patients (signed up via the
  // patient-side app) with no owning clinician yet. Any clinician can claim
  // one here into their own roster (see back/routes/PatientAPI.js).
  const [unclaimed,         setUnclaimed]         = useState([]);
  const [unclaimedLoading,  setUnclaimedLoading]  = useState(false);
  const [selectedUnclaimed, setSelectedUnclaimed] = useState(null);
  const [claiming,          setClaiming]          = useState(false);

  const flash = (msg) => { setStatus(msg); setTimeout(() => setStatus(""), 2000); };

  const loadPatients = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch(apiUrl(`/api/patients?userId=${userId}`), { headers: authHeader() });
      const data = await res.json();
      setPatients(data.patients || []);
    } catch {}
  }, [userId]);

  useEffect(() => { loadPatients(); }, [loadPatients]);

  const loadCalls = useCallback(async () => {
    setCallsLoading(true);
    try {
      const res = await fetch(apiUrl("/api/patient-call-log"), { headers: authHeader() });
      const data = await res.json();
      setCalls(data.calls || []);
    } catch {}
    finally { setCallsLoading(false); }
  }, []);

  useEffect(() => { if (mode === "calls") loadCalls(); }, [mode, loadCalls]);

  const loadUnclaimed = useCallback(async () => {
    setUnclaimedLoading(true);
    try {
      const res = await fetch(apiUrl("/api/patients/unclaimed"), { headers: authHeader() });
      const data = await res.json();
      setUnclaimed(data.patients || []);
    } catch {}
    finally { setUnclaimedLoading(false); }
  }, []);

  useEffect(() => { if (mode === "unclaimed") loadUnclaimed(); }, [mode, loadUnclaimed]);

  const claimPatient = async () => {
    if (!selectedUnclaimed || !userId) return;
    setClaiming(true);
    try {
      const res = await fetch(apiUrl(`/api/patients/${selectedUnclaimed._id}/claim`), {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      flash("Claimed into your roster");
      setSelectedUnclaimed(null);
      await loadUnclaimed();
      await loadPatients();
    } catch (e) { flash(`Error: ${e.message}`); }
    finally { setClaiming(false); }
  };

  const openCallLog = async (id) => {
    setSelectedCall(null);
    try {
      const res = await fetch(apiUrl(`/api/patient-call-log/${id}`), { headers: authHeader() });
      const data = await res.json();
      if (res.ok) setSelectedCall(data.call);
    } catch {}
  };

  const deleteCallLog = async (id) => {
    if (!window.confirm("Delete this call log? This cannot be undone.")) return;
    try {
      const res = await fetch(apiUrl(`/api/patient-call-log/${id}`), {
        method: "DELETE",
        headers: authHeader(),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      if (selectedCall?._id === id) setSelectedCall(null);
      await loadCalls();
      flash("Call log deleted");
    } catch (e) { flash(`Error: ${e.message}`); }
  };

  const loadMorpheForPatient = useCallback(async (patientDbId) => {
    if (!userId || !patientDbId) { setReceivedMorphe(null); return; }
    try {
      const res = await fetch(apiUrl(`/api/patient-models?userId=${userId}`));
      if (!res.ok) return;
      const all = await res.json();
      const morphe = all.find(m => m.patientDbId === patientDbId) || null;
      setReceivedMorphe(morphe);
    } catch { setReceivedMorphe(null); }
  }, [userId]);

  const openPatient = (p) => {
    setSelected(p);
    setIsNew(false);
    setPersonal({ ...EMPTY_PERSONAL, ...p.personal });
    setClinical({
      ...EMPTY_CLINICAL,
      ...p.clinical,
      vitalSigns: { ...EMPTY_CLINICAL.vitalSigns, ...p.clinical?.vitalSigns },
    });
    setTab("personal");
    loadMorpheForPatient(p._id);
  };

  const startNew = () => {
    setSelected(null);
    setIsNew(true);
    setPersonal(EMPTY_PERSONAL);
    setClinical(EMPTY_CLINICAL);
    setTab("personal");
    setReceivedMorphe(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isNew) {
        const res = await fetch(apiUrl("/api/patients"), {
          method: "POST",
          headers: authHeader(),
          body: JSON.stringify({ userId, personal, clinical }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        await loadPatients();
        setIsNew(false);
        setSelected(data.patient);
        flash("Patient created");
      } else {
        const res = await fetch(apiUrl(`/api/patients/${selected._id}`), {
          method: "PATCH",
          headers: authHeader(),
          body: JSON.stringify({ personal, clinical }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        await loadPatients();
        setSelected(data.patient);
        flash("Saved");
      }
    } catch (e) { flash(`Error: ${e.message}`); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!selected || !window.confirm(`Delete ${selected.patientId}?`)) return;
    setDeleting(true);
    try {
      await fetch(apiUrl(`/api/patients/${selected._id}`), { method: "DELETE", headers: authHeader() });
      await loadPatients();
      setSelected(null);
      setIsNew(false);
    } catch {}
    finally { setDeleting(false); }
  };

  const setVital = (key, val) =>
    setClinical(c => ({ ...c, vitalSigns: { ...c.vitalSigns, [key]: val } }));

  const hasForm = isNew || selected;

  return (
    <div id="pi_root">

      {/* Header */}
      <div id="pi_header">
        <button id="pi_back" onClick={() => navigate("/home")}>
          <i className="fi fi-rr-arrow-left" />
        </button>
        <span id="pi_title">Patient Instantiation</span>
        <div id="pi_mode_toggle">
          <button
            className={`pi_mode_btn${mode === "patients" ? " pi_mode_btn--active" : ""}`}
            onClick={() => setMode("patients")}
          >
            Patients
          </button>
          <button
            className={`pi_mode_btn${mode === "calls" ? " pi_mode_btn--active" : ""}`}
            onClick={() => setMode("calls")}
          >
            Call Log
          </button>
          <button
            className={`pi_mode_btn${mode === "unclaimed" ? " pi_mode_btn--active" : ""}`}
            onClick={() => setMode("unclaimed")}
          >
            Unclaimed{unclaimed.length > 0 ? ` (${unclaimed.length})` : ""}
          </button>
        </div>
        {mode === "patients" && hasForm && (
          <div id="pi_header_actions">
            {status && <span className="pi_status">{status}</span>}
            {selected && !isNew && (
              <button className="pi_btn pi_btn--danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting…" : <><i className="fi fi-rr-trash" /> Delete</>}
              </button>
            )}
            <button className="pi_btn pi_btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : <><i className="fi fi-rr-disk" /> {isNew ? "Create" : "Save"}</>}
            </button>
          </div>
        )}
        {mode === "unclaimed" && selectedUnclaimed && (
          <div id="pi_header_actions">
            {status && <span className="pi_status">{status}</span>}
            <button className="pi_btn pi_btn--primary" onClick={claimPatient} disabled={claiming}>
              {claiming ? "Claiming…" : <><i className="fi fi-rr-user-add" /> Claim into my roster</>}
            </button>
          </div>
        )}
      </div>

      <div id="pi_layout">

        {/* Sidebar */}
        <div id="pi_sidebar">
          {mode === "patients" && (
            <>
              <button id="pi_new_btn" onClick={startNew}>
                <i className="fi fi-rr-user-add" /> New Patient
              </button>
              <div id="pi_patient_list">
                {patients.length === 0 && (
                  <p id="pi_list_empty">No patients yet.</p>
                )}
                {patients.map(p => (
                  <button
                    key={p._id}
                    className={`pi_patient_item${selected?._id === p._id ? " pi_patient_item--active" : ""}`}
                    onClick={() => openPatient(p)}
                  >
                    <span className="pi_patient_id">{p.patientId}</span>
                    <span className="pi_patient_name">
                      {p.personal?.firstName || p.personal?.lastName
                        ? `${p.personal.firstName} ${p.personal.lastName}`.trim()
                        : "Unnamed"}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {mode === "calls" && (
            <div id="pi_patient_list">
              {callsLoading && <p id="pi_list_empty">Loading…</p>}
              {!callsLoading && calls.length === 0 && (
                <p id="pi_list_empty">No patient calls yet.</p>
              )}
              {calls.map(c => (
                <div key={c._id} className="pi_patient_item_row">
                  <button
                    className={`pi_patient_item${selectedCall?._id === c._id ? " pi_patient_item--active" : ""}`}
                    onClick={() => openCallLog(c._id)}
                  >
                    <span className="pi_patient_id">{c.patientName || "Unknown patient"}</span>
                    <span className="pi_patient_name">
                      {new Date(c.startedAt || c.createdAt).toLocaleString()} · {c.status} · {formatCallDuration(c)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="pi_patient_item_delete"
                    title="Delete call log"
                    onClick={(e) => { e.stopPropagation(); deleteCallLog(c._id); }}
                  >
                    <i className="fi fi-rr-trash" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {mode === "unclaimed" && (
            <div id="pi_patient_list">
              {unclaimedLoading && <p id="pi_list_empty">Loading…</p>}
              {!unclaimedLoading && unclaimed.length === 0 && (
                <p id="pi_list_empty">No unclaimed patients right now.</p>
              )}
              {unclaimed.map(p => (
                <button
                  key={p._id}
                  className={`pi_patient_item${selectedUnclaimed?._id === p._id ? " pi_patient_item--active" : ""}`}
                  onClick={() => setSelectedUnclaimed(p)}
                >
                  <span className="pi_patient_id">{p.patientId}</span>
                  <span className="pi_patient_name">
                    {p.personal?.firstName || p.personal?.lastName
                      ? `${p.personal.firstName} ${p.personal.lastName}`.trim()
                      : "Unnamed"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main content */}
        <div id="pi_content">
          {mode === "calls" && !selectedCall && (
            <div id="pi_welcome">
              <i className="fi fi-rr-phone-call pi_welcome_icon" />
              <p>Select a call to view the conversation.</p>
            </div>
          )}

          {mode === "calls" && selectedCall && (
            <div id="pi_call_detail">
              <div id="pi_patient_header">
                <span id="pi_patient_badge">{selectedCall.patientName || "Unknown patient"}</span>
                <span id="pi_patient_fullname">
                  {new Date(selectedCall.startedAt || selectedCall.createdAt).toLocaleString()} · {selectedCall.status} · {formatCallDuration(selectedCall)}
                </span>
                <button
                  className="pi_btn pi_btn--danger pi_call_delete_btn"
                  onClick={() => deleteCallLog(selectedCall._id)}
                >
                  <i className="fi fi-rr-trash" /> Delete
                </button>
              </div>

              {/* The patient's own instance, collected turn-by-turn during
                  this (and any other) call of theirs — see
                  agent/patientCallAgent.js's recordField tool. Read-only
                  here; edit it from the Patients tab instead. */}
              {selectedCall.patientId && (() => {
                const { personal = {}, clinical = {} } = selectedCall.patientId;
                const rows = [
                  ["First name", personal.firstName],
                  ["Last name", personal.lastName],
                  ["Date of birth", personal.dateOfBirth],
                  ["Gender", personal.gender],
                  ["Chief complaint", clinical.chiefComplaint],
                  ["History of present illness", clinical.historyOfPresentIllness],
                  ["Past medical history", clinical.pastMedicalHistory],
                  ["Family history", clinical.familyHistory],
                  ["Social history", clinical.socialHistory],
                  ["Allergies", clinical.allergies],
                  ["Chronic conditions", clinical.chronicConditions],
                  ["Current medications", clinical.currentMedications],
                ].filter(([, value]) => value);

                return (
                  <>
                    <h3 className="pi_call_section_title">
                      Patient instance <span className="pi_instance_id">{selectedCall.patientId.patientId}</span>
                    </h3>
                    <div className="pi_instance_grid">
                      {rows.length === 0 && (
                        <p className="pi_call_summary">Nothing collected into their profile yet.</p>
                      )}
                      {rows.map(([label, value]) => (
                        <div key={label} className="pi_instance_row">
                          <span className="pi_instance_label">{label}</span>
                          <span className="pi_instance_value">{value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}

              <h3 className="pi_call_section_title">Conversation summary</h3>
              <p className="pi_call_summary">{selectedCall.summary || "No summary available yet."}</p>
              <h3 className="pi_call_section_title">Full transcript</h3>
              <div className="pi_call_transcript">
                {(selectedCall.transcript || []).length === 0 && (
                  <p className="pi_call_summary">No transcript available.</p>
                )}
                {(selectedCall.transcript || []).map((t, i) => (
                  <div key={i} className={`pi_call_transcript_line pi_call_transcript_line--${t.role}`}>
                    <strong>{t.role === "agent" ? "MCTOSHS" : "Patient"}:</strong> {t.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          {mode === "unclaimed" && !selectedUnclaimed && (
            <div id="pi_welcome">
              <i className="fi fi-rr-user-add pi_welcome_icon" />
              <p>Select an unclaimed patient to review and claim them into your roster.</p>
            </div>
          )}

          {mode === "unclaimed" && selectedUnclaimed && (() => {
            const { personal = {}, clinical = {} } = selectedUnclaimed;
            const rows = [
              ["First name", personal.firstName],
              ["Last name", personal.lastName],
              ["Date of birth", personal.dateOfBirth],
              ["Gender", personal.gender],
              ["Email", personal.email],
              ["Chief complaint", clinical.chiefComplaint],
              ["History of present illness", clinical.historyOfPresentIllness],
              ["Past medical history", clinical.pastMedicalHistory],
              ["Family history", clinical.familyHistory],
              ["Social history", clinical.socialHistory],
              ["Allergies", clinical.allergies],
              ["Chronic conditions", clinical.chronicConditions],
              ["Current medications", clinical.currentMedications],
            ].filter(([, value]) => value);

            return (
              <div id="pi_call_detail">
                <div id="pi_patient_header">
                  <span id="pi_patient_badge">{selectedUnclaimed.patientId}</span>
                  <span id="pi_patient_fullname">
                    Self-registered · not yet in any clinician's roster
                  </span>
                </div>
                <h3 className="pi_call_section_title">Collected so far</h3>
                <div className="pi_instance_grid">
                  {rows.length === 0 && (
                    <p className="pi_call_summary">Nothing collected into their profile yet.</p>
                  )}
                  {rows.map(([label, value]) => (
                    <div key={label} className="pi_instance_row">
                      <span className="pi_instance_label">{label}</span>
                      <span className="pi_instance_value">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {mode === "patients" && !hasForm && (
            <div id="pi_welcome">
              <i className="fi fi-rr-hospital-user pi_welcome_icon" />
              <p>Select a patient or create a new one.</p>
            </div>
          )}

          {mode === "patients" && hasForm && (
            <>
              {/* Patient ID badge */}
              <div id="pi_patient_header">
                <span id="pi_patient_badge">
                  {isNew ? "New Patient" : selected?.patientId}
                </span>
                {!isNew && selected && (
                  <span id="pi_patient_fullname">
                    {[selected.personal?.firstName, selected.personal?.lastName].filter(Boolean).join(" ") || "Unnamed"}
                  </span>
                )}
                {receivedMorphe && (
                  <span id="pi_hylo_badge">
                    <i className="fi fi-rr-link" /> Hylomorphic Entity
                  </span>
                )}
              </div>

              {/* Tabs */}
              <div id="pi_tabs">
                <button className={`pi_tab${tab === "personal" ? " pi_tab--active" : ""}`} onClick={() => setTab("personal")}>
                  <i className="fi fi-rr-user" /> Human
                </button>
                <button className={`pi_tab${tab === "clinical" ? " pi_tab--active" : ""}`} onClick={() => setTab("clinical")}>
                  <i className="fi fi-rr-stethoscope" /> Clinical
                </button>
                {!isNew && (
                  <button className={`pi_tab${tab === "morphe" ? " pi_tab--active" : ""}`} onClick={() => setTab("morphe")}>
                    <i className="fi fi-rr-blueprint" /> Morphe
                  </button>
                )}
              </div>

              {/* Personal tab */}
              {tab === "personal" && (
                <div className="pi_form">
                  <p className="pi_form_section_title">Identity</p>
                  <div className="pi_form_grid">
                    <Field label="First Name"   value={personal.firstName}   onChange={v => setPersonal(p => ({ ...p, firstName: v }))} />
                    <Field label="Last Name"    value={personal.lastName}    onChange={v => setPersonal(p => ({ ...p, lastName: v }))} />
                    <Field label="Date of Birth" value={personal.dateOfBirth} onChange={v => setPersonal(p => ({ ...p, dateOfBirth: v }))} type="date" />
                    <div className="pi_field">
                      <label className="pi_field_label">Gender</label>
                      <select className="pi_field_input" value={personal.gender} onChange={e => setPersonal(p => ({ ...p, gender: e.target.value }))}>
                        <option value="">—</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                      </select>
                    </div>
                    <div className="pi_field">
                      <label className="pi_field_label">Nationality</label>
                      <select className="pi_field_input" value={personal.nationality} onChange={e => setPersonal(p => ({ ...p, nationality: e.target.value }))}>
                        <option value="">—</option>
                        {NATIONALITIES.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div className="pi_field">
                      <label className="pi_field_label">Phone</label>
                      <div className="pi_phone_row">
                        <PhoneCodeSelect
                          value={personal.phoneCode}
                          onChange={v => setPersonal(p => ({ ...p, phoneCode: v }))}
                        />
                        <input
                          className="pi_field_input pi_phone_number"
                          type="tel"
                          placeholder="Number"
                          value={personal.phoneNumber}
                          onChange={e => setPersonal(p => ({ ...p, phoneNumber: e.target.value }))}
                        />
                      </div>
                    </div>
                    <Field label="Email" value={personal.email} onChange={v => setPersonal(p => ({ ...p, email: v }))} type="email" />
                  </div>

                  <p className="pi_form_section_title">Address</p>
                  <div className="pi_form_grid">
                    <Field label="Street / House No." value={personal.street}     onChange={v => setPersonal(p => ({ ...p, street: v }))} />
                    <Field label="Apartment"   value={personal.apartment}   onChange={v => setPersonal(p => ({ ...p, apartment: v }))} />
                  </div>
                  <div className="pi_form_grid">
                    <Field label="City"        value={personal.city}       onChange={v => setPersonal(p => ({ ...p, city: v }))} />
                    <Field label="State / Province" value={personal.state}  onChange={v => setPersonal(p => ({ ...p, state: v }))} />
                    <Field label="Postal Code" value={personal.postalCode}  onChange={v => setPersonal(p => ({ ...p, postalCode: v }))} />
                    <div className="pi_field">
                      <label className="pi_field_label">Country</label>
                      <select className="pi_field_input" value={personal.country} onChange={e => setPersonal(p => ({ ...p, country: e.target.value }))}>
                        <option value="">—</option>
                        {COUNTRY_CODES.map(c => {
                          const name = c.label.replace(/\s*\(\+\d+\)$/, "").replace(/^.+?\s/, "");
                          return <option key={c.label} value={name}>{name}</option>;
                        })}
                      </select>
                    </div>
                  </div>

                  <div className="pi_form_grid">
                    <Field label="Occupation" value={personal.occupation} onChange={v => setPersonal(p => ({ ...p, occupation: v }))} />
                    <div className="pi_field">
                      <label className="pi_field_label">Marital Status</label>
                      <select className="pi_field_input" value={personal.maritalStatus} onChange={e => setPersonal(p => ({ ...p, maritalStatus: e.target.value }))}>
                        <option value="">—</option>
                        <option value="Single">Single</option>
                        <option value="Married">Married</option>
                        <option value="Divorced">Divorced</option>
                        <option value="Widowed">Widowed</option>
                        <option value="Separated">Separated</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>

                  <p className="pi_form_section_title">Psychological</p>
                  <div className="pi_form_grid">
                    <Field label="Current Mood" value={personal.currentMood} onChange={v => setPersonal(p => ({ ...p, currentMood: v }))} />
                  </div>
                  <Field label="Character" value={personal.character} onChange={v => setPersonal(p => ({ ...p, character: v }))} textarea />
                </div>
              )}

              {/* Clinical tab */}
              {tab === "clinical" && (
                <div className="pi_form">
                  <p className="pi_form_section_title">Presentation</p>
                  <Field label="Chief Complaint"               value={clinical.chiefComplaint}          onChange={v => setClinical(c => ({ ...c, chiefComplaint: v }))} textarea />
                  <Field label="History of Present Illness"    value={clinical.historyOfPresentIllness} onChange={v => setClinical(c => ({ ...c, historyOfPresentIllness: v }))} textarea />
                  <Field label="Past Medical History"          value={clinical.pastMedicalHistory}      onChange={v => setClinical(c => ({ ...c, pastMedicalHistory: v }))} textarea />
                  <Field label="Family History"                value={clinical.familyHistory}           onChange={v => setClinical(c => ({ ...c, familyHistory: v }))} textarea />
                  <Field label="Social History"                value={clinical.socialHistory}           onChange={v => setClinical(c => ({ ...c, socialHistory: v }))} textarea />

                  <p className="pi_form_section_title">Background</p>
                  <div className="pi_form_grid">
                    <div className="pi_field">
                      <label className="pi_field_label">Blood Type</label>
                      <select className="pi_field_input" value={clinical.bloodType} onChange={e => setClinical(c => ({ ...c, bloodType: e.target.value }))}>
                        <option value="">—</option>
                        {["A+","A−","B+","B−","AB+","AB−","O+","O−"].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <Field label="Allergies"            value={clinical.allergies}           onChange={v => setClinical(c => ({ ...c, allergies: v }))} textarea />
                  <Field label="Chronic Conditions"   value={clinical.chronicConditions}   onChange={v => setClinical(c => ({ ...c, chronicConditions: v }))} textarea />
                  <Field label="Current Medications"  value={clinical.currentMedications}  onChange={v => setClinical(c => ({ ...c, currentMedications: v }))} textarea />

                  <p className="pi_form_section_title">Vital Signs</p>
                  <div className="pi_form_grid">
                    <Field label="Height"             value={clinical.vitalSigns.height}           onChange={v => setVital("height", v)} />
                    <Field label="Weight"             value={clinical.vitalSigns.weight}           onChange={v => setVital("weight", v)} />
                    <Field label="Blood Pressure"     value={clinical.vitalSigns.bloodPressure}    onChange={v => setVital("bloodPressure", v)} />
                    <Field label="Heart Rate"         value={clinical.vitalSigns.heartRate}        onChange={v => setVital("heartRate", v)} />
                    <Field label="Temperature"        value={clinical.vitalSigns.temperature}      onChange={v => setVital("temperature", v)} />
                    <Field label="O₂ Saturation"      value={clinical.vitalSigns.oxygenSaturation} onChange={v => setVital("oxygenSaturation", v)} />
                  </div>
                </div>
              )}

              {/* Morphe tab */}
              {tab === "morphe" && !isNew && (
                <div className="pi_form">
                  {receivedMorphe ? (
                    <>
                      <div id="pi_morphe_entity_banner">
                        <span id="pi_morphe_entity_label">⬡ Hylomorphic Entity</span>
                        <span id="pi_morphe_entity_sub">
                          This Patient Instance has received a Morphe — schema and instantiation are unified.
                        </span>
                      </div>
                      <div id="pi_morphe_card">
                        <div id="pi_morphe_card_head">
                          <span className="pi_morphe_badge">MORPHE</span>
                          <span id="pi_morphe_name">{receivedMorphe.title || "Untitled"}</span>
                          {receivedMorphe.morpheType && (
                            <span id="pi_morphe_type">{receivedMorphe.morpheType}</span>
                          )}
                        </div>
                        {["objects","traces","phenomena","concepts","models","social"].map(key => {
                          const items = receivedMorphe[key] || [];
                          if (!items.length) return null;
                          return (
                            <div key={key} className="pi_morphe_dim">
                              <span className="pi_morphe_dim_name">{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                              <div className="pi_morphe_dim_items">
                                {items.map((it, i) => (
                                  <div key={i} className="pi_morphe_item">
                                    <span className="pi_morphe_item_name">{it.name}</span>
                                    {it.description && <span className="pi_morphe_item_desc">{it.description}</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div id="pi_morphe_empty">
                      <i className="fi fi-rr-blueprint" style={{ fontSize: "2rem", opacity: 0.3 }} />
                      <p>No Morphe has been designated to this Patient Instance yet.</p>
                      <p id="pi_morphe_hint">
                        Go to <strong>MCTOSHS Objects Modelling</strong> to build a Morphe and designate it to this representative object.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PatientInstantiationPage;

import React from "react";
import { DOMAINS, DOMAIN_LABELS } from "./amctoshsMorpheConstants";

// Left panel (spec §12) — the 9-AMCTOSHS-domain selector, plus an "All
// Domains" convenience option (not part of the spec's own enum, purely a
// UI affordance) so the page isn't forced to land on a domain with no
// saved data yet.
export default function MorpheDomainPanel({ activeDomain, onSelectDomain, countsByDomain }) {
  const countFor = (domain) => {
    const c = countsByDomain.get(domain);
    return c ? c.schemas + c.instances + c.traceSchemas + c.traceInstances : 0;
  };
  const totalCount = DOMAINS.reduce((n, d) => n + countFor(d), 0);

  return (
    <div id="mrp_domain_panel">
      <div className="mrp_panel_label">AMCTOSHS Domain</div>
      <button
        type="button"
        className={`mrp_domain_row${activeDomain === "all" ? " mrp_domain_row--active" : ""}`}
        onClick={() => onSelectDomain("all")}
      >
        <span className="mrp_domain_name">All Domains</span>
        <span className="mrp_domain_count">{totalCount}</span>
      </button>
      {DOMAINS.map((domain) => (
        <button
          key={domain}
          type="button"
          className={`mrp_domain_row${activeDomain === domain ? " mrp_domain_row--active" : ""}`}
          onClick={() => onSelectDomain(domain)}
        >
          <span className="mrp_domain_name">{DOMAIN_LABELS[domain]}</span>
          <span className="mrp_domain_count">{countFor(domain)}</span>
        </button>
      ))}
    </div>
  );
}

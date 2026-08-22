import { MW_COLUMNS, MW_COLUMN_GROUPS } from "../../merriamWebster/columns";

export default function MerriamWebsterColumnSelector({ selected, onChange }) {
  const selectedSet = new Set(selected);
  const toggle = (key) => {
    onChange(selectedSet.has(key) ? selected.filter((item) => item !== key) : [...selected, key]);
  };
  return (
    <details className="mw_column_selector">
      <summary><i className="fi fi-rr-settings-sliders" /> Columns</summary>
      <div className="mw_column_selector_panel">
        {Object.entries(MW_COLUMN_GROUPS).map(([groupKey, groupLabel]) => (
          <fieldset key={groupKey}>
            <legend>{groupLabel}</legend>
            {Object.entries(MW_COLUMNS).filter(([, column]) => column.group === groupKey).map(([key, column]) => (
              <label key={key}><input type="checkbox" checked={selectedSet.has(key)} onChange={() => toggle(key)} /> <span>{column.label}</span></label>
            ))}
          </fieldset>
        ))}
      </div>
    </details>
  );
}

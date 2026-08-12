function renderSubject(level) {
  if (!level.visual) return <span className="ontologySubjectPlaceholder">{level.label}</span>;
  if (typeof level.visual === "string") {
    return <img src={level.visual} alt="" draggable="false" />;
  }
  if (typeof level.visual === "function") {
    const SubjectComponent = level.visual;
    return <SubjectComponent level={level} />;
  }
  return level.visual;
}

export default function OntologySubject({ level, className = "", subjectRef }) {
  const bounds = level.visibleBounds;
  const style = {
    "--subject-anchor-x": `${level.contactAnchor.x * 100}%`,
    "--subject-anchor-y": `${level.contactAnchor.y * 100}%`,
    "--subject-scale-landscape": level.scale.landscape,
    "--subject-scale-portrait": level.scale.portrait,
  };
  const boundsStyle = bounds ? {
    left: `${(bounds.x / level.canvas.width) * 100}%`,
    top: `${(bounds.y / level.canvas.height) * 100}%`,
    width: `${(bounds.width / level.canvas.width) * 100}%`,
    height: `${(bounds.height / level.canvas.height) * 100}%`,
  } : undefined;

  return (
    <div
      className={`ontologySubject ${className}`.trim()}
      ref={subjectRef}
      data-level={level.id}
      style={style}
      aria-hidden="true"
    >
      {renderSubject(level)}
      {bounds && <span className="ontologyVisibleBounds" style={boundsStyle} />}
      <span
        className="ontologySubjectAnchor"
        style={{ left: style["--subject-anchor-x"], top: style["--subject-anchor-y"] }}
      />
    </div>
  );
}

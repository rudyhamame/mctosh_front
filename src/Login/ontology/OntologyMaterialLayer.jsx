import { forwardRef, useImperativeHandle, useRef } from "react";
import OntologySubject from "./OntologySubject";
import { getNextSubjectTransform, getSubjectTransform } from "./ontologyPhysics";
import { ONTOLOGY_LEVELS } from "./ontologyLevels";
import { ONTOLOGY_SUBJECT_SWAP_PROGRESS } from "./ontologyTimeline";

function subjectTransform(level, transform) {
  return `translate3d(calc(-${level.contactAnchor.x * 100}% + ${transform.xPx}px), calc(-${level.contactAnchor.y * 100}% + ${transform.pressureYVh}vh + ${transform.yPx}px), 0) rotate(${transform.rotation}deg) scale(var(--subject-scale)) scaleY(${transform.compression})`;
}

const OntologyMaterialLayer = forwardRef(function OntologyMaterialLayer(_, forwardedRef) {
  const subjectRefs = useRef([]);

  useImperativeHandle(forwardedRef, () => ({
    setVisualState(state) {
      const currentTransform = getSubjectTransform(state);
      const nextTransform = getNextSubjectTransform(state);
      const sameLevel = state.fromIndex === state.toIndex;
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const societyHasReplacedHyle = !sameLevel
        && state.localProgress >= ONTOLOGY_SUBJECT_SWAP_PROGRESS;

      subjectRefs.current.forEach((element, index) => {
        if (!element) return;
        const isCurrent = index === state.fromIndex && !societyHasReplacedHyle;
        const isNext = index === state.toIndex && societyHasReplacedHyle;
        element.style.opacity = isCurrent || isNext ? "1" : "0";
        element.style.visibility = isCurrent || isNext ? "visible" : "hidden";
        element.style.willChange = isCurrent || isNext ? "transform" : "auto";
        element.style.zIndex = isCurrent || isNext ? "1" : "0";

        if (isCurrent) {
          const transform = reducedMotion
            ? { ...currentTransform, xPx: 0, yPx: 0, rotation: 0, compression: 1 }
            : currentTransform;
          element.style.transform = subjectTransform(ONTOLOGY_LEVELS[index], transform);
          element.style.clipPath = "none";
        } else if (isNext) {
          element.style.transform = subjectTransform(ONTOLOGY_LEVELS[index], nextTransform);
          element.style.clipPath = "none";
        } else {
          element.style.transform = subjectTransform(ONTOLOGY_LEVELS[index], {
            xPx: 0, yPx: 0, pressureYVh: 0, rotation: 0, compression: 1,
          });
          element.style.clipPath = "none";
        }
      });
    },
  }), []);

  return (
    <div className="ontologyMaterialLayer">
      {ONTOLOGY_LEVELS.map((level, index) => (
        <OntologySubject
          className={index === 0 ? "is-initial" : ""}
          key={level.id}
          level={level}
          subjectRef={(element) => { subjectRefs.current[index] = element; }}
        />
      ))}
    </div>
  );
});

export default OntologyMaterialLayer;

import { forwardRef, useImperativeHandle, useRef } from "react";
import { ONTOLOGY_DEBUG_ENABLED, ONTOLOGY_SCENE_LEVELS } from "./ontologyLevels";

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smoothstep = (start, end, value) => {
  const progress = clamp01((value - start) / Math.max(0.0001, end - start));
  return progress * progress * (3 - (2 * progress));
};
const mix = (start, end, progress) => start + ((end - start) * progress);

function SceneDiagram({ variant }) {
  if (variant === "societies") {
    return (
      <svg viewBox="0 0 640 420" role="presentation">
        <g className="rhDiagramRules"><path d="M80 94L212 176L358 92L548 166M212 176L324 302L548 166M80 94L324 302M358 92L324 302" /></g>
        <g className="rhDiagramNodes"><circle cx="80" cy="94" r="17" /><circle cx="212" cy="176" r="23" /><circle cx="358" cy="92" r="14" /><circle cx="548" cy="166" r="19" /><circle className="is-target" cx="324" cy="302" r="36" /></g>
      </svg>
    );
  }
  if (variant === "humans") {
    return (
      <svg viewBox="0 0 640 420" role="presentation">
        <g className="rhDiagramRules"><path d="M320 66V350M246 122H394M222 213H418M260 306H380" /><ellipse cx="320" cy="210" rx="112" ry="154" /></g>
        <g className="rhDiagramNodes"><circle cx="320" cy="66" r="15" /><circle cx="267" cy="169" r="17" /><circle className="is-target" cx="354" cy="218" r="34" /><circle cx="292" cy="302" r="14" /></g>
      </svg>
    );
  }
  if (variant === "systems") {
    return (
      <svg viewBox="0 0 640 420" role="presentation">
        <g className="rhDiagramRules"><path d="M112 210H528M320 52V368" /><ellipse cx="320" cy="210" rx="210" ry="132" /><ellipse cx="320" cy="210" rx="145" ry="91" /></g>
        <g className="rhDiagramNodes"><circle cx="190" cy="210" r="18" /><circle cx="320" cy="118" r="16" /><circle className="is-target" cx="408" cy="224" r="38" /><circle cx="308" cy="305" r="14" /></g>
      </svg>
    );
  }
  if (variant === "organs") {
    return (
      <svg viewBox="0 0 640 420" role="presentation">
        <g className="rhDiagramRules"><path d="M114 292C171 65 418 45 520 196C579 284 490 359 350 342C235 329 155 371 114 292Z" /><path d="M184 270C258 232 298 151 316 82M316 82C347 159 401 215 488 247" /></g>
        <g className="rhDiagramNodes"><circle cx="184" cy="270" r="13" /><circle cx="316" cy="82" r="15" /><circle className="is-target" cx="350" cy="265" r="42" /><circle cx="488" cy="247" r="13" /></g>
      </svg>
    );
  }
  if (variant === "tissues") {
    return (
      <svg viewBox="0 0 640 420" role="presentation">
        <g className="rhDiagramRules rhDiagramWeave">
          {Array.from({ length: 7 }, (_, index) => <path key={`h-${index}`} d={`M78 ${74 + index * 46}C180 ${38 + index * 50} 420 ${112 + index * 38} 562 ${72 + index * 46}`} />)}
          {Array.from({ length: 8 }, (_, index) => <path key={`v-${index}`} d={`M${96 + index * 64} 52C${62 + index * 68} 170 ${140 + index * 56} 284 ${104 + index * 64} 372`} />)}
        </g>
        <g className="rhDiagramNodes"><circle className="is-target" cx="352" cy="228" r="32" /></g>
      </svg>
    );
  }
  if (variant === "cells") {
    return (
      <svg viewBox="0 0 640 420" role="presentation">
        <g className="rhDiagramNodes rhDiagramCells"><circle cx="155" cy="128" r="53" /><circle cx="305" cy="112" r="41" /><circle cx="486" cy="139" r="62" /><circle cx="208" cy="302" r="66" /><circle className="is-target" cx="405" cy="277" r="78" /><circle cx="405" cy="277" r="22" /></g>
      </svg>
    );
  }
  if (variant === "molecules") {
    return (
      <svg viewBox="0 0 640 420" role="presentation">
        <g className="rhDiagramRules"><path d="M112 248L220 133L346 206L468 109L540 254L398 327L346 206L220 313L112 248" /></g>
        <g className="rhDiagramNodes"><circle cx="112" cy="248" r="18" /><circle cx="220" cy="133" r="27" /><circle cx="220" cy="313" r="17" /><circle cx="346" cy="206" r="31" /><circle cx="468" cy="109" r="18" /><circle cx="540" cy="254" r="25" /><circle className="is-target" cx="398" cy="327" r="38" /></g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 640 420" role="presentation">
      <g className="rhDiagramRules"><path d="M142 210H498" /><path d="M320 54V366" /></g>
      <g className="rhDiagramNodes rhDiagramAtom"><circle cx="320" cy="210" r="9" /><circle className="is-target" cx="320" cy="210" r="54" /></g>
    </svg>
  );
}

const OntologyScrollScene = forwardRef(function OntologyScrollScene(_, forwardedRef) {
  const sceneRef = useRef(null);
  const levelRefs = useRef([]);
  const debugRef = useRef(null);

  useImperativeHandle(forwardedRef, () => ({
    setVisualState(state) {
      const entryProgress = clamp01(state.entryProgress ?? 1);
      const transitionProgress = state.localProgress;
      levelRefs.current.forEach((element, index) => {
        if (!element) return;
        let opacity = 0;
        let scale = 0.22;
        let translateX = 0;
        let translateY = 0;

        if (entryProgress < 1) {
          if (index === 0) {
            const reveal = smoothstep(0.18, 0.96, entryProgress);
            opacity = reveal;
            scale = mix(0.16, 1, reveal);
          }
        } else if (state.fromIndex === state.toIndex && index === state.fromIndex) {
          opacity = 1;
          scale = 1;
        } else if (index === state.fromIndex) {
          const exit = smoothstep(0.18, 1, transitionProgress);
          opacity = 1 - smoothstep(0.58, 0.98, transitionProgress);
          scale = mix(1, 3.4, exit);
          translateX = mix(0, index % 2 === 0 ? -7 : 7, exit);
          translateY = mix(0, -4, exit);
        } else if (index === state.toIndex) {
          const reveal = smoothstep(0.26, 0.92, transitionProgress);
          opacity = smoothstep(0.3, 0.82, transitionProgress);
          scale = mix(0.2, 1, reveal);
          translateY = mix(4, 0, reveal);
        }

        element.style.setProperty("--rh-level-opacity", String(opacity));
        element.style.setProperty("--rh-level-scale", String(scale));
        element.style.setProperty("--rh-level-x", `${translateX}vw`);
        element.style.setProperty("--rh-level-y", `${translateY}vh`);
        element.style.visibility = opacity > 0.002 ? "visible" : "hidden";
      });

      sceneRef.current?.style.setProperty("--rh-entry-progress", String(entryProgress));
      sceneRef.current?.style.setProperty("--rh-local-progress", String(transitionProgress));
      if (debugRef.current) {
        debugRef.current.textContent = [
          `depth: ${state.viewportProgress.toFixed(3)}`,
          `from: ${state.fromLevel.label}`,
          `to: ${state.toLevel.label}`,
          `transition: ${transitionProgress.toFixed(3)}`,
          `entry: ${entryProgress.toFixed(3)}`,
        ].join("\n");
      }
    },
  }), []);

  return (
    <section className="rhOntologyScene" ref={sceneRef} aria-hidden="true">
      <div className="rhPaperField" />
      {ONTOLOGY_SCENE_LEVELS.map((level, index) => (
        <article
          className={`rhLevelScene rhLevelScene--${level.variant}`}
          key={level.id}
          ref={(element) => { levelRefs.current[index] = element; }}
        >
          <div className="rhLevelCoordinates">RH / DEPTH {level.index}<br />ONTOLOGICAL SCALE</div>
          <div className="rhLevelParent">PARENT / {level.parent}</div>
          <div className="rhLevelDescriptor">{level.descriptor}</div>
          <h2>{level.label}</h2>
          <div className="rhLevelDiagram"><SceneDiagram variant={level.variant} /></div>
          {level.child ? (
            <div className="rhLevelTarget"><span>DESCENT TARGET</span><strong>{level.child}</strong><i>↓</i></div>
          ) : (
            <div className="rhLevelTarget rhLevelTarget--terminal"><span>TERMINAL DEPTH</span><strong>ENTITY</strong></div>
          )}
        </article>
      ))}
      {ONTOLOGY_DEBUG_ENABLED && <pre className="rhOntologyDebug" ref={debugRef} />}
    </section>
  );
});

export default OntologyScrollScene;

import { forwardRef, useImperativeHandle, useRef } from "react";
import ContactShadow from "./ContactShadow";
import HospitalStoneBackground from "./HospitalStoneBackground";
import OntologyMaterialLayer from "./OntologyMaterialLayer";
import OntologyParticleCanvas from "./OntologyParticleCanvas";
import { ONTOLOGY_DEBUG_ENABLED } from "./ontologyLevels";
import { getNextSubjectTransform, getSubjectTransform } from "./ontologyPhysics";
import "./ontology.css";

const OntologyScrollScene = forwardRef(function OntologyScrollScene(_, forwardedRef) {
  const sceneRef = useRef(null);
  const materialRef = useRef(null);
  const particleRef = useRef(null);
  const shadowRef = useRef(null);
  const debugRef = useRef(null);

  useImperativeHandle(forwardedRef, () => ({
    setVisualState(state) {
      sceneRef.current?.style.setProperty("--ontology-local-progress", String(state.localProgress));
      shadowRef.current?.setVisualState(state);
      materialRef.current?.setVisualState(state);
      particleRef.current?.setVisualState(state);
      if (debugRef.current) {
        const transform = getSubjectTransform(state);
        const nextTransform = getNextSubjectTransform(state);
        debugRef.current.textContent = [
          `viewportProgress: ${state.viewportProgress.toFixed(3)}`,
          `from: ${state.fromLevel.label.toUpperCase()}`,
          `to: ${state.toLevel.label.toUpperCase()}`,
          `localProgress: ${state.localProgress.toFixed(3)}`,
          `phase: ${state.phase}`,
          `wiggleX: ${transform.xPx.toFixed(2)}px`,
          `wiggleY: ${transform.yPx.toFixed(2)}px`,
          `wiggleRotation: ${transform.rotation.toFixed(2)}deg`,
          `pressureY: ${transform.pressureYVh.toFixed(2)}vh`,
          `nextFollowX: ${nextTransform.xPx.toFixed(2)}px`,
          `nextReveal: ${state.nextLevelReveal.toFixed(3)}`,
          `particles: ${particleRef.current?.getRenderedCount() || 0}`,
        ].join("\n");
      }
    },
  }), []);

  return (
    <section className={`ontologyScene${ONTOLOGY_DEBUG_ENABLED ? " ontologyDebugEnabled" : ""}`} ref={sceneRef} aria-label="Patient Reality ontology sequence">
      <HospitalStoneBackground />
      {ONTOLOGY_DEBUG_ENABLED && <span className="ontologyGroundContactDebug" aria-hidden="true" />}
      <ContactShadow ref={shadowRef} />
      <OntologyMaterialLayer ref={materialRef} />
      <OntologyParticleCanvas ref={particleRef} />
      {ONTOLOGY_DEBUG_ENABLED && <pre className="ontologyDebug" ref={debugRef} />}
    </section>
  );
});

export default OntologyScrollScene;

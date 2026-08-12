import { forwardRef, useImperativeHandle, useRef } from "react";
import { ONTOLOGY_MOTION, getSubjectTransform } from "./ontologyPhysics";
import { clamp01 } from "./ontologyTimeline";

const mix = (from, to, amount) => from + ((to - from) * amount);

const ContactShadow = forwardRef(function ContactShadow(_, forwardedRef) {
  const shadowRef = useRef(null);

  useImperativeHandle(forwardedRef, () => ({
    setVisualState(state) {
      const shadow = shadowRef.current;
      if (!shadow) return;
      const transform = getSubjectTransform(state);
      const maximumDistance = Math.max(1, ONTOLOGY_MOTION.pressureDistanceVh);
      const proximity = ONTOLOGY_MOTION.pressureEnabled
        ? 1 - clamp01(transform.distanceToGroundVh / maximumDistance)
        : 1;
      const widthScale = mix(1.12, 0.82, proximity);
      const blur = mix(20, 8, proximity);
      const opacity = mix(0.16, 0.3, proximity);
      shadow.style.setProperty("--contact-shadow-x", "0px");
      shadow.style.setProperty("--contact-shadow-scale", String(widthScale));
      shadow.style.setProperty("--contact-shadow-blur", `${blur}px`);
      shadow.style.setProperty("--contact-shadow-opacity", String(opacity));
    },
  }), []);

  return <div className="ontologyContactShadow" ref={shadowRef} aria-hidden="true" />;
});

export default ContactShadow;

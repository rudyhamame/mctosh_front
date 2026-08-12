import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { ONTOLOGY_TRANSITION_COUNT } from "./ontologyLevels";
import { getOntologyLayout, getParticlePosition } from "./ontologyPhysics";
import { createOntologyParticles } from "./ontologyParticles";

const STONE_BASE = Object.freeze([190, 172, 156]);

function stoneColor(particle, lightness, alpha) {
  const tone = particle.tone || 0;
  const channels = STONE_BASE.map((channel) => Math.round(Math.max(0, Math.min(255, channel + tone + lightness))));
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

function fragmentVertices(particle, size) {
  return Array.from({ length: particle.sides }, (_, index) => {
    const angle = (index / particle.sides) * Math.PI * 2;
    const radius = size * 0.52 * (particle.vertexScales?.[index] || 1);
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * 0.7,
    };
  });
}

function tracePolygon(context, vertices, offsetX = 0, offsetY = 0) {
  context.beginPath();
  vertices.forEach((vertex, index) => {
    const x = vertex.x + offsetX;
    const y = vertex.y + offsetY;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
}

function drawFragment(context, particle, position) {
  context.save();
  context.translate(position.x, position.y);
  context.rotate(position.rotation);
  const vertices = fragmentVertices(particle, position.size);
  const depth = Math.max(1, position.size * particle.depthRatio);
  const depthX = depth * 0.28;
  const depthY = depth * 0.62;

  context.fillStyle = `rgba(87, 72, 60, ${position.alpha * 0.12})`;
  context.beginPath();
  context.ellipse(depthX, depthY + (position.size * 0.24), position.size * 0.48, position.size * 0.16, 0, 0, Math.PI * 2);
  context.fill();

  tracePolygon(context, vertices, depthX, depthY);
  context.fillStyle = stoneColor(particle, -42, position.alpha);
  context.fill();

  vertices.forEach((vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    context.beginPath();
    context.moveTo(vertex.x, vertex.y);
    context.lineTo(next.x, next.y);
    context.lineTo(next.x + depthX, next.y + depthY);
    context.lineTo(vertex.x + depthX, vertex.y + depthY);
    context.closePath();
    context.fillStyle = stoneColor(particle, index % 2 === 0 ? -24 : -38, position.alpha);
    context.fill();
  });

  const topLight = context.createLinearGradient(-position.size * 0.35, -position.size * 0.35, position.size * 0.4, position.size * 0.4);
  topLight.addColorStop(0, stoneColor(particle, 52, position.alpha));
  topLight.addColorStop(0.48, stoneColor(particle, 18, position.alpha));
  topLight.addColorStop(1, stoneColor(particle, -9, position.alpha));
  tracePolygon(context, vertices);
  context.fillStyle = topLight;
  context.fill();
  context.strokeStyle = stoneColor(particle, 66, position.alpha * 0.5);
  context.lineWidth = Math.max(0.45, position.size * 0.035);
  context.stroke();
  context.restore();
}

function drawGrit(context, particle, position) {
  context.save();
  context.translate(position.x, position.y);
  context.rotate(position.rotation);
  const width = position.size;
  const height = position.size * 0.58;
  const depth = Math.max(0.7, position.size * particle.depthRatio);
  context.fillStyle = stoneColor(particle, -36, position.alpha);
  context.fillRect((-width / 2) + depth, (-height / 2) + depth, width, height);
  context.fillStyle = stoneColor(particle, -18, position.alpha);
  context.beginPath();
  context.moveTo(width / 2, -height / 2);
  context.lineTo((width / 2) + depth, (-height / 2) + depth);
  context.lineTo((width / 2) + depth, (height / 2) + depth);
  context.lineTo(width / 2, height / 2);
  context.closePath();
  context.fill();
  context.fillStyle = stoneColor(particle, 28, position.alpha);
  context.fillRect(-width / 2, -height / 2, width, height);
  context.restore();
}

function drawDust(context, position) {
  const gradient = context.createRadialGradient(
    position.x,
    position.y,
    0,
    position.x,
    position.y,
    position.size,
  );
  gradient.addColorStop(0, `rgba(196, 181, 165, ${position.alpha})`);
  gradient.addColorStop(1, "rgba(214, 202, 188, 0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(position.x, position.y, position.size, 0, Math.PI * 2);
  context.fill();
}

const OntologyParticleCanvas = forwardRef(function OntologyParticleCanvas(_, forwardedRef) {
  const canvasRef = useRef(null);
  const dimensionsRef = useRef({ width: 1, height: 1, dpr: 1 });
  const stateRef = useRef(null);
  const renderedCountRef = useRef(0);
  const transitionParticles = useMemo(() => (
    Array.from({ length: ONTOLOGY_TRANSITION_COUNT }, (_, index) => createOntologyParticles(index))
  ), []);

  const drawTransition = (context, particles, progress, layout) => {
    let count = 0;
    particles.forEach((particle) => {
      const contact = {
        x: layout.subjectCenterX,
        y: layout.groundY,
        scale: layout.particleScale,
      };
      const position = getParticlePosition(particle, progress, contact);
      if (!position || position.alpha <= 0.002) return;
      if (particle.kind === "fragment") drawFragment(context, particle, position);
      else if (particle.kind === "grit") drawGrit(context, particle, position);
      else drawDust(context, position);
      count += 1;
    });
    return count;
  };

  const draw = () => {
    const canvas = canvasRef.current;
    const state = stateRef.current;
    if (!canvas || !state) return;
    const context = canvas.getContext("2d");
    const { width, height, dpr } = dimensionsRef.current;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const groundValue = getComputedStyle(canvas).getPropertyValue("--ontology-ground-y").trim();
    const groundRatio = groundValue.endsWith("%")
      ? Number.parseFloat(groundValue) / 100
      : undefined;
    const layout = getOntologyLayout(width, height, groundRatio);

    let renderedCount = 0;
    for (let index = 0; index < state.fromIndex; index += 1) {
      renderedCount += drawTransition(context, transitionParticles[index], 1, layout);
    }
    if (!state.atFinalLevel) {
      renderedCount += drawTransition(
        context,
        transitionParticles[state.transitionIndex],
        state.localProgress,
        layout,
      );
    }
    renderedCountRef.current = renderedCount;
  };

  useImperativeHandle(forwardedRef, () => ({
    setVisualState(state) {
      stateRef.current = state;
      draw();
    },
    getRenderedCount() {
      return renderedCountRef.current;
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      dimensionsRef.current = { width, height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, []);

  return <canvas className="ontologyParticleCanvas" ref={canvasRef} aria-hidden="true" />;
});

export default OntologyParticleCanvas;

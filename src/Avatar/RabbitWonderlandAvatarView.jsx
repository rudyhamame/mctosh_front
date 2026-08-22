import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import RabbitLogoBlink, { RABBIT_LOGO_LISTENING_FRAMES, RABBIT_LOGO_SPEAKING_FRAMES, RABBIT_LOGO_TYPING_FRAMES } from "../Shared/RabbitLogoBlink";
import "./rabbitWonderlandAvatar.css";

const ListeningLogo = () => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrame((current) => {
        const candidates = RABBIT_LOGO_LISTENING_FRAMES
          .map((_, index) => index)
          .filter((index) => index !== current);
        return candidates[Math.floor(Math.random() * candidates.length)];
      });
    }, 420);
    return () => window.clearInterval(timer);
  }, []);

  return <img className="rabbit_wonderland_avatar_logo_image" src={RABBIT_LOGO_LISTENING_FRAMES[frame]} alt="Rabbit listening" />;
};

const SpeakingLogo = () => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrame((current) => {
        const candidates = RABBIT_LOGO_SPEAKING_FRAMES
          .map((_, index) => index)
          .filter((index) => index !== current);
        return candidates[Math.floor(Math.random() * candidates.length)];
      });
    }, 180);
    return () => window.clearInterval(timer);
  }, []);

  return <img className="rabbit_wonderland_avatar_logo_image" src={RABBIT_LOGO_SPEAKING_FRAMES[frame]} alt="Rabbit speaking" />;
};

const TypingLogo = ({ text = "" }) => {
  const [frame, setFrame] = useState(0);
  const animatedLengthRef = useRef(0);
  const textLengthRef = useRef(text.length);
  textLengthRef.current = text.length;
  if (text.length < animatedLengthRef.current) animatedLengthRef.current = text.length;

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (animatedLengthRef.current >= textLengthRef.current) return;
      animatedLengthRef.current += 1;
      setFrame((current) => {
        const candidates = RABBIT_LOGO_TYPING_FRAMES
          .map((_, index) => index)
          .filter((index) => index !== current);
        return candidates[Math.floor(Math.random() * candidates.length)];
      });
    }, 90);
    return () => window.clearInterval(timer);
  }, []);

  return <img className="rabbit_wonderland_avatar_logo_image" src={RABBIT_LOGO_TYPING_FRAMES[frame]} alt="Rabbit typing" />;
};

const ThinkingLogo = () => {
  const logoRef = useRef(null);

  useEffect(() => {
    const blink = () => void logoRef.current?.playBlink();
    blink();
    const timer = window.setInterval(blink, 4200);
    return () => window.clearInterval(timer);
  }, []);

  return <RabbitLogoBlink ref={logoRef} blinkOnly className="rabbit_wonderland_avatar_logo_image" alt="Rabbit thinking" />;
};

const RabbitWonderlandAvatarView = forwardRef(({ activity = "idle", typingText = "", onSpeechCaptionChange = null }, ref) => {
  const [caption, setCaption] = useState("");
  const statusLabel = activity === "waiting"
    ? "Waiting"
    : activity === "typing"
      ? "Typing"
      : activity === "listening"
    ? "Listening"
    : activity === "speaking"
      ? "Speaking"
      : activity === "thinking"
        ? "Thinking"
        : "Idle";

  useImperativeHandle(ref, () => ({
    // HomeChat uses the browser TTS fallback for this visual-only provider.
    isLive: () => false,
    streamChunk: (text) => {
      setCaption((current) => {
        const next = `${current}${text || ""}`;
        onSpeechCaptionChange?.(next);
        return next;
      });
    },
    streamSpeechChunk: (text) => {
      setCaption((current) => {
        const next = `${current}${text || ""}`;
        onSpeechCaptionChange?.(next);
        return next;
      });
    },
    endMessage: () => {},
    stop: () => window.speechSynthesis.cancel(),
    unlockAudio: () => {},
    destroy: () => {},
  }), [onSpeechCaptionChange]);

  return (
    <div className="rabbit_wonderland_avatar" aria-label="Rabbit of Wonderland avatar">
      <div className="rabbit_wonderland_avatar_logo">
        <span className={`rabbit_wonderland_avatar_status rabbit_wonderland_avatar_status--${activity}`} aria-live="polite">{statusLabel}</span>
        {activity === "waiting" || activity === "thinking" ? <ThinkingLogo /> : activity === "listening" ? <ListeningLogo /> : activity === "speaking" ? <SpeakingLogo /> : activity === "typing" ? <TypingLogo text={typingText} /> : <RabbitLogoBlink blinkOnly alt="Rabbit of Wonderland" />}
      </div>
    </div>
  );
});

RabbitWonderlandAvatarView.displayName = "RabbitWonderlandAvatarView";

export default RabbitWonderlandAvatarView;

import type React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

export const HelloWorld: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0b1120",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div style={{ opacity, color: "white", fontSize: 80, fontWeight: 700 }}>
        Hello, studyAI
      </div>
    </AbsoluteFill>
  );
};

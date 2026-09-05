import type { Finger } from "./keymap";

/**
 * Finger metadata for the keyboard visualization — labels + TypeKernel
 * palette colors (per-finger color coding, §1 Keyboard Fundamentals).
 */

export interface FingerMeta {
  label: string;
  hand: "left" | "right";
  /** Tailwind text color class from the TypeKernel palette. */
  textClass: string;
  /** Tailwind background class used for finger legend chips. */
  bgClass: string;
}

export const FINGERS: Record<Finger, FingerMeta> = {
  "pinky-l": {
    label: "Left Pinky",
    hand: "left",
    textClass: "text-outline",
    bgClass: "bg-surface-container-highest",
  },
  "ring-l": {
    label: "Left Ring",
    hand: "left",
    textClass: "text-secondary",
    bgClass: "bg-secondary-container/40",
  },
  "middle-l": {
    label: "Left Middle",
    hand: "left",
    textClass: "text-tertiary",
    bgClass: "bg-tertiary-container/40",
  },
  "index-l": {
    label: "Left Index",
    hand: "left",
    textClass: "text-primary",
    bgClass: "bg-primary-container/40",
  },
  thumb: {
    label: "Thumb",
    hand: "right",
    textClass: "text-primary-container",
    bgClass: "bg-primary-container/25",
  },
  "index-r": {
    label: "Right Index",
    hand: "right",
    textClass: "text-primary",
    bgClass: "bg-primary-container/40",
  },
  "middle-r": {
    label: "Right Middle",
    hand: "right",
    textClass: "text-tertiary",
    bgClass: "bg-tertiary-container/40",
  },
  "ring-r": {
    label: "Right Ring",
    hand: "right",
    textClass: "text-secondary",
    bgClass: "bg-secondary-container/40",
  },
  "pinky-r": {
    label: "Right Pinky",
    hand: "right",
    textClass: "text-outline",
    bgClass: "bg-surface-container-highest",
  },
};

/** Left-to-right display order of the fingers. */
export const FINGER_ORDER: Finger[] = [
  "pinky-l",
  "ring-l",
  "middle-l",
  "index-l",
  "thumb",
  "index-r",
  "middle-r",
  "ring-r",
  "pinky-r",
];

import React from "react";
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  ReduceMotion,
  SlideInLeft,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from "react-native-reanimated";

export const motion = {
  fast: 100,
  normal: 190,
  route: 260,
  easing: Easing.out(Easing.cubic),
  spring: { damping: 18, stiffness: 260, mass: 0.55 }
} as const;

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

type MotionPressableProps = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  pressedScale?: number;
};

export function MotionPressable({ style, pressedScale = 0.975, onPressIn, onPressOut, disabled, ...props }: MotionPressableProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressableBase
      {...props}
      disabled={disabled}
      style={[style, animatedStyle]}
      onPressIn={(event) => {
        scale.value = withTiming(pressedScale, { duration: motion.fast, easing: motion.easing, reduceMotion: ReduceMotion.System });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withSpring(1, { ...motion.spring, reduceMotion: ReduceMotion.System });
        onPressOut?.(event);
      }}
    />
  );
}

export function MotionPage({ children }: { children: React.ReactNode }) {
  return (
    <Animated.View
      style={{ flex: 1 }}
      entering={FadeInDown.duration(motion.route).easing(motion.easing).withInitialValues({ opacity: 0.92, transform: [{ translateY: 8 }] }).reduceMotion(ReduceMotion.System)}
      exiting={FadeOut.duration(motion.fast).reduceMotion(ReduceMotion.System)}
    >
      {children}
    </Animated.View>
  );
}

export function MotionListItem({ children, index = 0 }: { children: React.ReactNode; index?: number }) {
  return (
    <Animated.View entering={FadeIn.duration(motion.normal).delay(Math.min(index, 5) * 35).reduceMotion(ReduceMotion.System)}>
      {children}
    </Animated.View>
  );
}

export function MotionDrawer({ children }: { children: React.ReactNode }) {
  return (
    <Animated.View
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      entering={SlideInLeft.duration(motion.route).easing(motion.easing).reduceMotion(ReduceMotion.System)}
    >
      {children}
    </Animated.View>
  );
}

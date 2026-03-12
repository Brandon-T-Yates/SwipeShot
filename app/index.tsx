import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Dimensions,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as MediaLibrary from 'expo-media-library';
import * as Haptics from 'expo-haptics';
import type { Asset } from 'expo-media-library';
import React from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';

const PHOTO_STACK_SIZE = 50;
const SESSION_SOFT_LIMIT = 1000;
const LOAD_MORE_THRESHOLD = 5;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const IMAGE_SIZE = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) * 0.8;
const CARD_BORDER_RADIUS = 30;
const SWIPE_THRESHOLD = 80;
const MAX_ROTATION = 15;
const SPRING_CONFIG = { damping: 20, stiffness: 200 };

// OLED & minimal palette
const COLORS = {
  background: '#000000',
  border: '#1A1A1A',
  trash: '#FF3B30',
  keep: '#34C759',
  pillBg: 'rgba(255,255,255,0.08)',
  text: '#FFFFFF',
  textMuted: 'rgba(255,255,255,0.6)',
};

function TrashPill({
  count,
  pulseTrigger,
}: {
  count: number;
  pulseTrigger: number;
}) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (count > 0 && pulseTrigger > 0) {
      scale.value = withSpring(1.15, { damping: 12, stiffness: 200 }, () => {
        scale.value = withSpring(1);
      });
    }
  }, [pulseTrigger, count]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.pill, animatedStyle]}>
      <Text style={styles.pillCount}>🗑 {count}</Text>
    </Animated.View>
  );
}

function StackCard({
  asset,
  index,
  isTop,
  onSwipeComplete,
}: {
  asset: Asset;
  index: number;
  isTop: boolean;
  onSwipeComplete: (action: 'keep' | 'delete') => void;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .enabled(isTop)
    .activeOffsetX([-20, 20])
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY * 0.3;
    })
    .onEnd((e) => {
      const threshold = SWIPE_THRESHOLD;
      const velocity = e.velocityX;
      const shouldDismissLeft =
        translateX.value < -threshold || velocity < -500;
      const shouldDismissRight =
        translateX.value > threshold || velocity > 500;

      if (shouldDismissLeft) {
        translateX.value = withSpring(
          -SCREEN_WIDTH * 1.2,
          { damping: 15, stiffness: 120 },
          (finished) => {
            if (finished) runOnJS(onSwipeComplete)('delete');
          }
        );
      } else if (shouldDismissRight) {
        translateX.value = withSpring(
          SCREEN_WIDTH * 1.2,
          { damping: 15, stiffness: 120 },
          (finished) => {
            if (finished) runOnJS(onSwipeComplete)('keep');
          }
        );
      } else {
        translateX.value = withSpring(0, SPRING_CONFIG);
        translateY.value = withSpring(0, SPRING_CONFIG);
      }
    });

  const animatedCardStyle = useAnimatedStyle(() => {
    const rotation = interpolate(
      translateX.value,
      [-SCREEN_WIDTH / 2, 0, SCREEN_WIDTH / 2],
      [MAX_ROTATION, 0, -MAX_ROTATION],
      Extrapolation.CLAMP
    );
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { rotate: `${rotation}deg` },
      ],
    };
  });

  const trashOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [-SCREEN_WIDTH * 0.3, -SWIPE_THRESHOLD],
      [1, 0],
      Extrapolation.CLAMP
    ),
  }));

  const keepOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [SWIPE_THRESHOLD, SCREEN_WIDTH * 0.3],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }));

  const scale = 1 - index * 0.06;
  const opacity = 1 - index * 0.25;
  const zIndex = 10 - index;

  return (
    <View
      style={[
        styles.stackCard,
        {
          transform: [{ scale }],
          opacity,
          zIndex,
        },
      ]}
      pointerEvents={isTop ? 'auto' : 'none'}
    >
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.cardInner, animatedCardStyle]}>
          <View style={styles.cardImageWrapper}>
            <Image
              source={{ uri: asset.uri }}
              style={styles.cardImage}
              contentFit="cover"
              priority={isTop ? 'high' : 'low'}
            />
          </View>
          {isTop && (
            <>
              <Animated.View style={[styles.swipeLabel, styles.trashLabel, trashOpacity]}>
                <Text style={styles.trashLabelText}>TRASH</Text>
              </Animated.View>
              <Animated.View style={[styles.swipeLabel, styles.keepLabel, keepOpacity]}>
                <Text style={styles.keepLabelText}>KEEP</Text>
              </Animated.View>
            </>
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export default function Index() {
  const [permissionResponse, requestPermission] = MediaLibrary.usePermissions();
  const [photos, setPhotos] = useState<Asset[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [trashBin, setTrashBin] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalSortedInSession, setTotalSortedInSession] = useState(0);
  const [endCursor, setEndCursor] = useState<string | undefined>(undefined);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [trashPulseTrigger, setTrashPulseTrigger] = useState(0);

  const handleKeepRef = React.useRef<() => void>(() => {});
  const handleDeleteRef = React.useRef<() => void>(() => {});
  const loadMoreInProgressRef = React.useRef(false);

  const handleKeep = useCallback(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    setCurrentIndex((i) => i + 1);
  }, []);

  const handleDelete = useCallback(() => {
    const currentPhoto = photos[currentIndex];
    if (!currentPhoto) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setTrashBin((prev) => [...prev, currentPhoto]);
    setTrashPulseTrigger((t) => t + 1);
    setPhotos((prev) => prev.filter((p) => p.id !== currentPhoto.id));
    setCurrentIndex((i) => Math.min(i, Math.max(0, photos.length - 2)));
  }, [photos, currentIndex]);

  const handleCommitTrash = useCallback(async () => {
    if (trashBin.length === 0) return;
    try {
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      }
      await MediaLibrary.deleteAssetsAsync(trashBin);
      setTrashBin([]);
    } catch (err) {
      console.error('Batch delete failed:', err);
    }
  }, [trashBin]);

  const handleUndo = useCallback(() => {
    if (trashBin.length === 0) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const lastAsset = trashBin[trashBin.length - 1];
    setTrashBin((prev) => prev.slice(0, -1));
    setPhotos((prev) => {
      const next = [...prev];
      next.splice(Math.min(currentIndex, next.length), 0, lastAsset);
      return next;
    });
  }, [trashBin, currentIndex]);

  const handleUndoAll = useCallback(() => {
    if (trashBin.length === 0) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setPhotos((prev) => {
      const next = [...prev];
      const insertAt = Math.min(currentIndex, next.length);
      next.splice(insertAt, 0, ...trashBin);
      return next;
    });
    setTrashBin([]);
  }, [trashBin, currentIndex]);

  const fetchPhotos = useCallback(async () => {
    try {
      const result = await MediaLibrary.getAssetsAsync({
        first: PHOTO_STACK_SIZE,
        mediaType: ['photo'],
        sortBy: MediaLibrary.SortBy.creationTime,
      });
      setPhotos(result.assets);
      setCurrentIndex(0);
      setTrashBin([]);
      setTotalSortedInSession(0);
      setEndCursor(result.endCursor);
      setHasNextPage(result.hasNextPage);
    } catch {
      setPhotos([]);
      setCurrentIndex(0);
      setEndCursor(undefined);
      setHasNextPage(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMorePhotos = useCallback(async () => {
    if (!endCursor || !hasNextPage || loadMoreInProgressRef.current) return;
    loadMoreInProgressRef.current = true;
    setLoadingMore(true);
    try {
      const result = await MediaLibrary.getAssetsAsync({
        first: PHOTO_STACK_SIZE,
        after: endCursor,
        mediaType: ['photo'],
        sortBy: MediaLibrary.SortBy.creationTime,
      });
      setPhotos((prev) => [...prev, ...result.assets]);
      setEndCursor(result.endCursor);
      setHasNextPage(result.hasNextPage);
    } catch {
      setHasNextPage(false);
    } finally {
      setLoadingMore(false);
      loadMoreInProgressRef.current = false;
    }
  }, [endCursor, hasNextPage]);

  useEffect(() => {
    if (permissionResponse?.granted) {
      fetchPhotos();
    } else {
      setLoading(false);
    }
  }, [permissionResponse?.granted, fetchPhotos]);

  useEffect(() => {
    const distanceFromEnd = photos.length - currentIndex;
    if (
      distanceFromEnd <= LOAD_MORE_THRESHOLD &&
      hasNextPage &&
      !loadingMore &&
      photos.length > 0
    ) {
      loadMorePhotos();
    }
  }, [currentIndex, photos.length, hasNextPage, loadingMore, loadMorePhotos]);

  useEffect(() => {
    const uris = [1, 2, 3]
      .map((i) => photos[currentIndex + i]?.uri)
      .filter(Boolean) as string[];
    if (uris.length > 0) Image.prefetch(uris);
  }, [currentIndex, photos]);

  const handleGrantAccess = useCallback(async () => {
    await requestPermission();
  }, [requestPermission]);

  handleKeepRef.current = handleKeep;
  handleDeleteRef.current = handleDelete;

  const handleCommitTrashRef = React.useRef<() => void>(() => {});
  handleCommitTrashRef.current = handleCommitTrash;
  const trashBinRef = React.useRef(trashBin);
  trashBinRef.current = trashBin;

  const onSwipeComplete = useCallback(
    (action: 'keep' | 'delete') => {
      setTotalSortedInSession((n) => n + 1);
      if (action === 'keep') {
        handleKeepRef.current();
      } else {
        handleDeleteRef.current();
      }
    },
    []
  );

  useEffect(() => {
    if (totalSortedInSession === SESSION_SOFT_LIMIT && trashBinRef.current.length > 0) {
      Alert.alert(
        'Manual Labor Alert! 🚨',
        "We would hate for you to lose all that hard work. You've sorted 1,000 photos! Do you want to empty the trash now before you keep going?",
        [
          { text: 'Keep Swiping', style: 'cancel' },
          {
            text: 'Empty Trash',
            onPress: () => handleCommitTrashRef.current(),
          },
        ]
      );
    }
  }, [totalSortedInSession]);

  if (permissionResponse === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.text} />
      </View>
    );
  }

  if (!permissionResponse?.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>SwipeShot needs to see your photos</Text>
        <Pressable
          onPress={handleGrantAccess}
          style={({ pressed }) => [styles.button, { opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={styles.buttonText}>Grant Access</Text>
        </Pressable>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.text} />
      </View>
    );
  }

  const currentPhoto = photos[currentIndex];
  const isStackEmpty = photos.length === 0;
  const isStackExhausted = currentIndex >= photos.length;

  if (isStackEmpty) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.emptyContent}>
          <Text style={styles.message}>No photos found</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isStackExhausted) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {trashBin.length > 0 && (
          <View style={styles.headerBar}>
            <TrashPill count={trashBin.length} pulseTrigger={trashPulseTrigger} />
            <View style={styles.batchActions}>
              <Pressable
                onPress={handleCommitTrash}
                style={({ pressed }) => [
                  styles.emptyTrashLink,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={styles.emptyTrashText}>Empty Trash</Text>
              </Pressable>
              <Text style={styles.batchDivider}>·</Text>
              <Pressable
                onPress={handleUndo}
                style={({ pressed }) => [
                  styles.undoLink,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={styles.undoLinkText}>Undo</Text>
              </Pressable>
              <Text style={styles.batchDivider}>·</Text>
              <Pressable
                onPress={handleUndoAll}
                style={({ pressed }) => [
                  styles.undoLink,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={styles.undoLinkText}>Undo All</Text>
              </Pressable>
            </View>
          </View>
        )}
        <View style={styles.emptyContent}>
          {loadingMore ? (
            <ActivityIndicator size="large" color={COLORS.text} />
          ) : (
            <Text style={styles.message}>
              {hasNextPage ? 'Loading more…' : 'All caught up!'}
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (!currentPhoto) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>No photos found</Text>
      </View>
    );
  }

  const stackPhotos = [
    photos[currentIndex],
    photos[currentIndex + 1],
    photos[currentIndex + 2],
  ].filter(Boolean);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerBar}>
        {trashBin.length > 0 ? (
          <>
            <TrashPill count={trashBin.length} pulseTrigger={trashPulseTrigger} />
            <View style={styles.batchActions}>
              <Pressable
                onPress={handleCommitTrash}
                style={({ pressed }) => [
                  styles.emptyTrashLink,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={styles.emptyTrashText}>Empty Trash</Text>
              </Pressable>
              <Text style={styles.batchDivider}>·</Text>
              <Pressable
                onPress={handleUndo}
                style={({ pressed }) => [
                  styles.undoLink,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={styles.undoLinkText}>Undo</Text>
              </Pressable>
              <Text style={styles.batchDivider}>·</Text>
              <Pressable
                onPress={handleUndoAll}
                style={({ pressed }) => [
                  styles.undoLink,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={styles.undoLinkText}>Undo All</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.pill}>
            <Text style={styles.pillCountMuted}>SwipeShot</Text>
          </View>
        )}
      </View>

      <View style={styles.stackContainer}>
        {stackPhotos.map((asset, i) => (
          <StackCard
            key={asset.id}
            asset={asset}
            index={i}
            isTop={i === 0}
            onSwipeComplete={onSwipeComplete}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <Pressable
          onPress={handleDelete}
          style={({ pressed }) => [
            styles.controlButton,
            styles.deleteButton,
            pressed && styles.controlButtonFilled,
            pressed && styles.deleteButtonFilled,
          ]}
        >
          {({ pressed }) => (
            <Ionicons
              name="close-circle-outline"
              size={32}
              color={pressed ? COLORS.text : COLORS.trash}
            />
          )}
        </Pressable>
        <Pressable
          onPress={handleKeep}
          style={({ pressed }) => [
            styles.controlButton,
            styles.keepButton,
            pressed && styles.controlButtonFilled,
            pressed && styles.keepButtonFilled,
          ]}
        >
          {({ pressed }) => (
            <Ionicons
              name="checkmark-circle-outline"
              size={32}
              color={pressed ? COLORS.text : COLORS.keep}
            />
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: COLORS.pillBg,
  },
  pillCount: {
    color: COLORS.text,
    fontSize: 15,
  },
  pillCountMuted: {
    color: COLORS.textMuted,
    fontSize: 15,
  },
  batchActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  emptyTrashLink: {
    paddingVertical: 4,
  },
  emptyTrashText: {
    color: COLORS.textMuted,
    fontSize: 15,
  },
  batchDivider: {
    color: COLORS.textMuted,
    fontSize: 15,
  },
  undoLink: {
    paddingVertical: 4,
  },
  undoLinkText: {
    color: COLORS.textMuted,
    fontSize: 15,
  },
  emptyContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  message: {
    color: COLORS.text,
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  loadMoreButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
  },
  buttonText: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '600',
  },
  stackContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stackCard: {
    position: 'absolute',
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInner: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardImageWrapper: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    borderRadius: CARD_BORDER_RADIUS,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    borderRadius: CARD_BORDER_RADIUS - 1,
  },
  swipeLabel: {
    position: 'absolute',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 3,
  },
  trashLabel: {
    left: 24,
    top: '50%',
    marginTop: -20,
    borderColor: COLORS.trash,
  },
  trashLabelText: {
    color: COLORS.trash,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 2,
  },
  keepLabel: {
    right: 24,
    top: '50%',
    marginTop: -20,
    borderColor: COLORS.keep,
  },
  keepLabelText: {
    color: COLORS.keep,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 2,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 48,
    paddingVertical: 24,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  controlButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  controlButtonFilled: {
    borderWidth: 0,
  },
  deleteButton: {
    borderColor: COLORS.trash,
  },
  deleteButtonFilled: {
    backgroundColor: COLORS.trash,
  },
  keepButton: {
    borderColor: COLORS.keep,
  },
  keepButtonFilled: {
    backgroundColor: COLORS.keep,
  },
});

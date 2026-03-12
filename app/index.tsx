import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Dimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as MediaLibrary from 'expo-media-library';
import * as Haptics from 'expo-haptics';
import type { Asset } from 'expo-media-library';
import React from 'react';

const PHOTO_STACK_SIZE = 50;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const IMAGE_SIZE = Math.min(SCREEN_WIDTH, SCREEN_HEIGHT) * 0.8;

function XIcon() {
  return (
    <View style={iconStyles.xContainer}>
      <View style={[iconStyles.xLine, iconStyles.xLine1]} />
      <View style={[iconStyles.xLine, iconStyles.xLine2]} />
    </View>
  );
}

function CheckIcon() {
  return (
    <View style={iconStyles.checkContainer}>
      <View style={[iconStyles.checkStem]} />
      <View style={[iconStyles.checkKick]} />
    </View>
  );
}

export default function Index() {
  const [permissionResponse, requestPermission] = MediaLibrary.usePermissions();
  const [photos, setPhotos] = useState<Asset[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [trashBin, setTrashBin] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPhotos = useCallback(async () => {
    try {
      const { assets } = await MediaLibrary.getAssetsAsync({
        first: PHOTO_STACK_SIZE,
        mediaType: ['photo'],
        sortBy: MediaLibrary.SortBy.creationTime,
      });
      setPhotos(assets);
      setCurrentIndex(0);
      setTrashBin([]);
    } catch {
      setPhotos([]);
      setCurrentIndex(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (permissionResponse?.granted) {
      fetchPhotos();
    } else {
      setLoading(false);
    }
  }, [permissionResponse?.granted, fetchPhotos]);

  const handleGrantAccess = useCallback(async () => {
    await requestPermission();
  }, [requestPermission]);

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

  const handleLoadMore = useCallback(() => {
    setLoading(true);
    fetchPhotos();
  }, [fetchPhotos]);

  if (permissionResponse === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#FFFFFF" />
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
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  const currentPhoto = photos[currentIndex];
  const isStackEmpty = photos.length === 0;
  const isStackExhausted = currentIndex >= photos.length;

  if (isStackEmpty || isStackExhausted) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {trashBin.length > 0 && (
          <View style={styles.topBar}>
            <Pressable
              onPress={handleCommitTrash}
              style={({ pressed }) => [
                styles.trashButton,
                { opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.trashButtonText}>
                🗑️ ({trashBin.length})
              </Text>
            </Pressable>
            <Pressable
              onPress={handleUndo}
              style={({ pressed }) => [
                styles.undoButton,
                { opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.undoButtonText}>Undo</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.emptyContent}>
          <Text style={styles.message}>Library Organized!</Text>
          <Pressable
            onPress={handleLoadMore}
            style={({ pressed }) => [
              styles.loadMoreButton,
              { opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={styles.buttonText}>Load More</Text>
          </Pressable>
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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        {trashBin.length > 0 ? (
          <>
            <Pressable
              onPress={handleCommitTrash}
              style={({ pressed }) => [
                styles.trashButton,
                { opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.trashButtonText}>
                🗑️ ({trashBin.length})
              </Text>
            </Pressable>
            <Pressable
              onPress={handleUndo}
              style={({ pressed }) => [
                styles.undoButton,
                { opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={styles.undoButtonText}>Undo</Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.topBarSpacer} />
        )}
      </View>
      <View style={styles.imageWrapper}>
        <Image
          source={{ uri: currentPhoto.uri }}
          style={styles.image}
          contentFit="cover"
        />
      </View>
      <View style={styles.footer}>
        <Pressable
          onPress={handleDelete}
          style={({ pressed }) => [
            styles.controlButton,
            styles.deleteButton,
            { opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <XIcon />
        </Pressable>
        <Pressable
          onPress={handleKeep}
          style={({ pressed }) => [
            styles.controlButton,
            styles.keepButton,
            { opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <CheckIcon />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const iconStyles = StyleSheet.create({
  xContainer: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  xLine: {
    position: 'absolute',
    width: 20,
    height: 3,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
  },
  xLine1: { transform: [{ rotate: '45deg' }] },
  xLine2: { transform: [{ rotate: '-45deg' }] },
  checkContainer: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkStem: {
    position: 'absolute',
    width: 4,
    height: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
    transform: [{ rotate: '-45deg' }, { translateX: -2 }, { translateY: 2 }],
  },
  checkKick: {
    position: 'absolute',
    width: 4,
    height: 22,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
    transform: [{ rotate: '45deg' }, { translateX: 6 }, { translateY: -4 }],
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  topBarSpacer: {
    flex: 1,
  },
  emptyContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trashButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  trashButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
  },
  undoButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  undoButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
  },
  message: {
    color: '#FFFFFF',
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
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  imageWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    borderRadius: 16,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 48,
    paddingVertical: 24,
    paddingBottom: 8,
  },
  controlButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
  },
  keepButton: {
    backgroundColor: '#34C759',
  },
});

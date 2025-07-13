import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Platform } from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import * as FaceDetector from 'expo-face-detector';

interface FaceCaptureModalProps {
  visible: boolean;
  onCapture: (photoData: Uint8Array) => void;
  onCancel: () => void;
  mode: 'registration' | 'authentication';
}

export const FaceCaptureModal: React.FC<FaceCaptureModalProps> = ({
  visible,
  onCapture,
  onCancel,
  mode,
}) => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const cameraRef = useRef<Camera>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const handleFacesDetected = useCallback(({ faces }: { faces: FaceDetector.FaceFeature[] }) => {
    if (faces.length > 0 && !capturing) {
      setFaceDetected(true);
      
      // Автоматический захват после обнаружения лица
      if (mode === 'authentication') {
        setTimeout(() => capturePhoto(), 1000);
      }
    } else if (faces.length === 0) {
      setFaceDetected(false);
    }
  }, [capturing, mode]);

  const capturePhoto = useCallback(async () => {
    if (!cameraRef.current || capturing) return;

    setCapturing(true);
    
    // Обратный отсчет для регистрации
    if (mode === 'registration') {
      for (let i = 3; i > 0; i--) {
        setCountdown(i);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: true,
        skipProcessing: true,
      });

      if (photo.base64) {
        const binaryString = atob(photo.base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        onCapture(bytes);
      }
    } catch (error) {
      console.error('Error capturing photo:', error);
    } finally {
      setCapturing(false);
      setCountdown(3);
    }
  }, [capturing, mode, onCapture]);

  if (hasPermission === null) {
    return null;
  }

  if (hasPermission === false) {
    return (
      <Modal visible={visible} animationType="slide">
        <View style={styles.container}>
          <Text style={styles.errorText}>
            Нет доступа к камере. Пожалуйста, разрешите доступ в настройках.
          </Text>
          <TouchableOpacity style={styles.button} onPress={onCancel}>
            <Text style={styles.buttonText}>Закрыть</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide">
      <View style={styles.container}>
        <Camera
          ref={cameraRef}
          style={styles.camera}
          type={CameraType.front}
          onFacesDetected={handleFacesDetected}
          faceDetectorSettings={{
            mode: FaceDetector.FaceDetectorMode.accurate,
            detectLandmarks: FaceDetector.FaceDetectorLandmarks.all,
            runClassifications: FaceDetector.FaceDetectorClassifications.all,
            minDetectionInterval: 100,
            tracking: true,
          }}
        >
          <View style={styles.overlay}>
            <View style={styles.faceGuide}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
            
            {capturing && mode === 'registration' && (
              <Text style={styles.countdownText}>{countdown}</Text>
            )}
            
            <Text style={styles.instructionText}>
              {!faceDetected
                ? 'Поместите лицо в рамку'
                : mode === 'registration'
                ? 'Держите лицо в рамке'
                : 'Обнаружено лицо, идет проверка...'}
            </Text>
          </View>
        </Camera>

        <View style={styles.controls}>
          {mode === 'registration' && !capturing && (
            <TouchableOpacity
              style={[styles.captureButton, !faceDetected && styles.disabledButton]}
              onPress={capturePhoto}
              disabled={!faceDetected}
            >
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>
          )}
          
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelButtonText}>Отмена</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  faceGuide: {
    width: 250,
    height: 350,
    position: 'absolute',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#4ECDC4',
    borderWidth: 3,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  topRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  instructionText: {
    position: 'absolute',
    bottom: 150,
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  countdownText: {
    fontSize: 72,
    color: '#4ECDC4',
    fontWeight: 'bold',
  },
  controls: {
    position: 'absolute',
    bottom: 50,
    width: '100%',
    alignItems: 'center',
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#4ECDC4',
  },
  disabledButton: {
    opacity: 0.5,
  },
  cancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
  },
  button: {
    backgroundColor: '#4ECDC4',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
    marginTop: 20,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 20,
  },
});

import React, { useRef, useCallback, useEffect, useState } from 'react';

interface CameraCaptureProps {
  onCapture: (photoData: Uint8Array) => void;
  onError: (error: Error) => void;
  mode: 'registration' | 'authentication';
}

export const CameraCapture: React.FC<CameraCaptureProps> = ({
  onCapture,
  onError,
  mode,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  useEffect(() => {
    startCamera();
    
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setHasPermission(true);
        setIsReady(true);
      }
    } catch (error) {
      console.error('Camera error:', error);
      setHasPermission(false);
      onError(new Error('Не удалось получить доступ к камере'));
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !isReady) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    if (!context) return;

    // Установка размеров canvas
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Отрисовка кадра
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Конвертация в Blob
    canvas.toBlob(async (blob) => {
      if (!blob) {
        onError(new Error('Не удалось захватить изображение'));
        return;
      }

      // Конвертация Blob в Uint8Array
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      onCapture(uint8Array);
    }, 'image/jpeg', 0.95);
  }, [isReady, onCapture, onError]);

  if (hasPermission === false) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>
          <h3>Нет доступа к камере</h3>
          <p>Пожалуйста, разрешите доступ к камере в настройках браузера</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.videoContainer}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={styles.video}
        />
        <div style={styles.overlay}>
          <div style={styles.faceGuide} />
          <p style={styles.instruction}>
            {mode === 'registration' 
              ? 'Поместите лицо в центр рамки'
              : 'Посмотрите в камеру для входа'}
          </p>
        </div>
      </div>
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <button
        onClick={capturePhoto}
        style={styles.captureButton}
        disabled={!isReady}
      >
        {mode === 'registration' ? 'Сделать фото' : 'Войти'}
      </button>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '20px',
    width: '100%',
    maxWidth: '600px',
    margin: '0 auto',
  },
  videoContainer: {
    position: 'relative',
    width: '100%',
    marginBottom: '20px',
    borderRadius: '12px',
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  video: {
    width: '100%',
    height: 'auto',
    display: 'block',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  faceGuide: {
    width: '250px',
    height: '350px',
    border: '3px solid #4FD1C5',
    borderRadius: '50%',
    marginBottom: '20px',
  },
  instruction: {
    color: '#fff',
    fontSize: '18px',
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: '10px 20px',
    borderRadius: '8px',
  },
  captureButton: {
    backgroundColor: '#4FD1C5',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 32px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  error: {
    textAlign: 'center',
    padding: '40px',
    backgroundColor: '#FFF5F5',
    borderRadius: '12px',
    border: '1px solid #FED7D7',
  },
};

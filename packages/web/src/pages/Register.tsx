import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Shield, AlertCircle } from 'lucide-react';
import { useServices } from '../contexts/ServiceContext';
import { useAuth } from '../contexts/AuthContext';

export function Register() {
  const navigate = useNavigate();
  const { identityService } = useServices();
  const { login } = useAuth();
  
  const [step, setStep] = useState(1);
  const [photoData, setPhotoData] = useState<Uint8Array | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  
  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' } 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      
      setStream(mediaStream);
    } catch (err) {
      setError('Camera access denied. Please allow camera access to continue.');
    }
  };
  
  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    
    if (!context) return;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);
    
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Verify face detection
      const faceDetected = await identityService.detectFace(uint8Array);
      
      if (!faceDetected) {
        setError('No face detected. Please ensure your face is clearly visible.');
        return;
      }
      
      setPhotoData(uint8Array);
      
      // Stop camera
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
      
      setStep(2);
    }, 'image/jpeg', 0.9);
  };
  
  const handleRegister = async () => {
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    
    if (!photoData) {
      setError('Photo is required');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const result = await identityService.createDID(photoData);
      
      // Set password for future logins
      await identityService.setPassword(result.did, password);
      
      // Login user
      await login(result.did);
      
      navigate('/chat');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-# Messa - Защищенный мессенджер

## 📁 Структура проекта

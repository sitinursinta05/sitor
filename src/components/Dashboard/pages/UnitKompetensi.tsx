import { useState, useEffect, useMemo } from 'react';
import { 
  Search, X, CheckCircle2, 
  Building2, UserCircle2, 
  Briefcase, Save,
  ArrowRightCircle, Filter, Edit3, Edit, Trash2, Camera,
  Download, Upload
} from 'lucide-react';
import api, { STORAGE_URL } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import ImageCropperModal from '../../common/ImageCropperModal';

// --- FUNGSI BANTUAN UNTUK STATUS SERTIFIKAT ---
const calculateStatus = (dateString: string) => {
  if (!dateString || dateString === '-') return '-';
  
  const expDate = new Date(dateString);
  if (isNaN(expDate.getTime())) return '-';
  
  const today = new Date();
  expDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  const diffTime = expDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'Expired';
  if (diffDays <= 90) return 'Hampir Expired';
  return 'Aktif';
};

// --- KOMPONEN BANTUAN UNTUK GRAFIK MELINGKAR (DONUT CHART) ---
const CircularProgress = ({ title, valueText, percentage }: {title: string, valueText: string | number, percentage: number}) => {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const validPercentage = isNaN(percentage) ? 0 : percentage;
  const strokeDashoffset = circumference - (validPercentage / 100) * circumference;

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 flex flex-col h-full">
      <h3 className="text-[13px] font-bold text-gray-800 mb-4">{title}</h3>
      <div className="flex-1 flex items-center justify-center relative">
        <svg className="w-28 h-28 transform -rotate-90">
          <circle cx="56" cy="56" r={radius} stroke="#f1f5f9" strokeWidth="8" fill="transparent" />
          <circle 
            cx="56" cy="56" r={radius} 
            stroke="#3b82f6" 
            strokeWidth="8" 
            fill="transparent"
            strokeDasharray={circumference} 
            strokeDashoffset={strokeDashoffset} 
            strokeLinecap="round" 
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute flex items-center justify-center text-lg font-bold text-gray-800">
          {valueText}
        </div>
      </div>
    </div>
  );
};

export default function UnitKompetensi() {
  const { user } = useAuth();
  const [selectedCompany, setSelectedCompany] = useState('Semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<any>(null);
  
  // State untuk Add Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [posValue, setPosValue] = useState('');
  const [unitValue, setUnitValue] = useState('');
  const [addPhotoPreview, setAddPhotoPreview] = useState<string | null>(null);
  const [addPhotoFile, setAddPhotoFile] = useState<File | null>(null);

  // State untuk Edit Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingPerson, setEditingPerson] = useState<any>(null);
  const [editPhotoPreview, setEditPhotoPreview] = useState<string | null>(null);
  const [editPhotoFile, setEditPhotoFile] = useState<File | null>(null);

  // State untuk Cropper
  const [showCropper, setShowCropper] = useState(false);
  const [tempImageSrc, setTempImageSrc] = useState<string | null>(null);
        <ImageCropperModal
          imageSrc={tempImageSrc}
          onCropComplete={handleCropComplete}
          onCancel={() => {
            setShowCropper(false);
            setTempImageSrc(null);
            setActiveCropMode(null);
          }}
        />
      )}
    </div>
  );
}

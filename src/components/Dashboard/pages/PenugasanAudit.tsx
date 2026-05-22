import { useState, useEffect } from 'react';
import { X, Download, Upload, Edit, Plus, Trash2 } from 'lucide-react';
import api, { STORAGE_URL } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';

// Tipe data untuk Status Kelayakan
type StatusKelayakan = 'Layak Ditugaskan' | 'Perlu Penguatan' | 'Tidak Direkomendasikan';



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

export default function PenugasanAudit() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  
  // Data Master dari API
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [allDiklat, setAllDiklat] = useState<any[]>([]);
  
  // State untuk Tab / Unit Kerja
  const [unitKerjas, setUnitKerjas] = useState<string[]>([]);
  const [selectedAudit, setSelectedAudit] = useState<string>(''); // Merupakan Unit Kerja

  // Type untuk Sub-Penugasan
  type SubAudit = {
    id: string;
    name: string;
    kriteria: string;
  };

  // Data Evaluasi Per Unit Kerja -> SubAudit -> User
  const [evaluationStatuses, setEvaluationStatuses] = useState<Record<string, Record<string, Record<string | number, StatusKelayakan>>>>({});
  
  // Data Keterangan Per Unit Kerja -> SubAudit -> User
  const [keteranganMap, setKeteranganMap] = useState<Record<string, Record<string, Record<string | number, string>>>>({});

  // Data Penugasan (Topik Audit) Per Unit Kerja
  const [kompetensiWajibMap, setKompetensiWajibMap] = useState<Record<string, SubAudit[]>>({});
  const [selectedSubAudit, setSelectedSubAudit] = useState<string>('');
  
  // State untuk Edit Penugasan Modal
  const [showEditReqModal, setShowEditReqModal] = useState(false);
  const [tempReqs, setTempReqs] = useState<SubAudit[]>([]);
  const [newReqName, setNewReqName] = useState('');
  const [newReqKriteria, setNewReqKriteria] = useState('');

  // State Untuk Modal Profil Personel (Persis Profil Kompetensi)
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<any>(null);
  const [profileYearFilter, setProfileYearFilter] = useState<string>('Semua');

  // State Untuk Pratinjau Dokumen
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewFileData, setPreviewFileData] = useState<{ fileName: string; fileUrl: string; fileType: string; } | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadFile = async (fileUrl: string, fileName: string) => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      let path = '';
      const storageKey = '/storage/';
      const idx = fileUrl.indexOf(storageKey);
      if (idx !== -1) {
        path = fileUrl.substring(idx + storageKey.length);
      } else {
        path = fileUrl.split('/').pop() || '';
      }

      const response = await api.get(`/download-file?path=${encodeURIComponent(path)}`, {
        responseType: 'blob'
      });

      const blob = new Blob([response.data], { type: response.headers['content-type'] || 'application/octet-stream' });
      const blobUrl = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download failed:', error);
      window.open(fileUrl, '_blank');
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Load local storage statuses
    const savedStatusStr = localStorage.getItem('penugasanAuditStatus');
    if (savedStatusStr) setEvaluationStatuses(JSON.parse(savedStatusStr));

    const savedKeteranganStr = localStorage.getItem('keteranganMap');
    if (savedKeteranganStr) setKeteranganMap(JSON.parse(savedKeteranganStr));
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [usersRes, diklatRes, penugasanRes] = await Promise.all([
        api.get('/users'),
        api.get('/diklat'),
        api.get('/penugasan-kompetensi').catch(() => ({ data: [] }))
      ]);

      const users = usersRes.data.filter((u: any) => u.role === 'User' || u.role === 'Manajemen');
      setAllUsers(users);
      setAllDiklat(diklatRes.data);

      // Konversi data API penugasan ke format kompetensiWajibMap
      let mapFromAPI: Record<string, SubAudit[]> = {};
      let evalStatuses: Record<string, Record<string, Record<string | number, StatusKelayakan>>> = {};
      let ketMap: Record<string, Record<string, Record<string | number, string>>> = {};

      if (penugasanRes.data && penugasanRes.data.length > 0) {
        penugasanRes.data.forEach((item: any) => {
          if (!mapFromAPI[item.unit_kerja]) {
            mapFromAPI[item.unit_kerja] = [];
          }
          mapFromAPI[item.unit_kerja].push({
            id: item.id.toString(),
            name: item.nama_penugasan,
            kriteria: item.kriteria || 'Tidak ada keterangan/kriteria khusus.'
          });

          // Extract evaluations if available
          if (item.evaluations && item.evaluations.length > 0) {
            item.evaluations.forEach((ev: any) => {
              if (!evalStatuses[item.unit_kerja]) evalStatuses[item.unit_kerja] = {};
              if (!evalStatuses[item.unit_kerja][item.id.toString()]) evalStatuses[item.unit_kerja][item.id.toString()] = {};
              evalStatuses[item.unit_kerja][item.id.toString()][ev.user_id] = ev.status;

              if (!ketMap[item.unit_kerja]) ketMap[item.unit_kerja] = {};
              if (!ketMap[item.unit_kerja][item.id.toString()]) ketMap[item.unit_kerja][item.id.toString()] = {};
              ketMap[item.unit_kerja][item.id.toString()][ev.user_id] = ev.keterangan || '';
            });
          }
        });
        setKompetensiWajibMap(mapFromAPI);
        
        // Merge with existing states (API takes priority)
        setEvaluationStatuses(prev => {
          const merged = { ...prev, ...evalStatuses };
          localStorage.setItem('penugasanAuditStatus', JSON.stringify(merged));
          return merged;
        });

        setKeteranganMap(prev => {
          const merged = { ...prev, ...ketMap };
          localStorage.setItem('keteranganMap', JSON.stringify(merged));
          return merged;
        });
      } else {
        // Fallback: coba load dari localStorage jika API endpoint belum tersedia
        const savedReqsStr = localStorage.getItem('kompetensiWajibMap');
        if (savedReqsStr) {
          try {
            mapFromAPI = JSON.parse(savedReqsStr);
            setKompetensiWajibMap(mapFromAPI);
          } catch (e) {
            console.warn('Gagal parse kompetensiWajibMap dari localStorage', e);
          }
        }
      }

      const uniqueUnits: string[] = Array.from(new Set(users.map((u: any) => u.unit_kerja).filter(Boolean)));
      setUnitKerjas(uniqueUnits);
      
      if (uniqueUnits.length > 0 && !selectedAudit) {
        setSelectedAudit(uniqueUnits[0]);
      }
    } catch (error) {
      console.error('API Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (auditorId: string | number, newStatus: StatusKelayakan) => {
    if (!selectedSubAudit) return;
    const updatedStatuses = { ...evaluationStatuses };
    if (!updatedStatuses[selectedAudit]) updatedStatuses[selectedAudit] = {};
    if (!updatedStatuses[selectedAudit][selectedSubAudit]) updatedStatuses[selectedAudit][selectedSubAudit] = {};
    
    updatedStatuses[selectedAudit][selectedSubAudit][auditorId] = newStatus;
    
    setEvaluationStatuses(updatedStatuses);
    localStorage.setItem('penugasanAuditStatus', JSON.stringify(updatedStatuses));

    try {
      await api.post(`/audit-topics/${selectedSubAudit}/evaluations/${auditorId}`, {
        status: newStatus
      });
    } catch (error) {
      console.error('Failed to save status to server', error);
    }
  };

  const handleKeteranganChange = async (auditorId: string | number, text: string) => {
    if (!selectedSubAudit) return;
    const updatedKeterangan = { ...keteranganMap };
    if (!updatedKeterangan[selectedAudit]) updatedKeterangan[selectedAudit] = {};
    if (!updatedKeterangan[selectedAudit][selectedSubAudit]) updatedKeterangan[selectedAudit][selectedSubAudit] = {};
    
    updatedKeterangan[selectedAudit][selectedSubAudit][auditorId] = text;
    
    setKeteranganMap(updatedKeterangan);
    localStorage.setItem('keteranganMap', JSON.stringify(updatedKeterangan));

    try {
      await api.post(`/audit-topics/${selectedSubAudit}/evaluations/${auditorId}`, {
        keterangan: text
      });
    } catch (error) {
      console.error('Failed to save keterangan to server', error);
    }
  };

  useEffect(() => {
    // Select first sub-audit automatically when audit unit changes
    const reqs = kompetensiWajibMap[selectedAudit] || [];
    if (reqs.length > 0) {
      if (!reqs.find(r => r.id === selectedSubAudit)) {
        setSelectedSubAudit(reqs[0].id);
      }
    } else {
      setSelectedSubAudit('');
    }
  }, [selectedAudit, kompetensiWajibMap]);

  const openReqModal = () => {
    setTempReqs(kompetensiWajibMap[selectedAudit] || []);
    setNewReqName('');
    setNewReqKriteria('');
    setShowEditReqModal(true);
  };

  const addReq = () => {
    if (newReqName.trim()) {
      setTempReqs([
        ...tempReqs, 
        { 
          id: Date.now().toString(), 
          name: newReqName.trim(), 
          kriteria: newReqKriteria.trim() || 'Tidak ada keterangan/kriteria khusus.' 
        }
      ]);
      setNewReqName('');
      setNewReqKriteria('');
    }
  };

  const removeReq = (index: number) => {
    const arr = [...tempReqs];
    arr.splice(index, 1);
    setTempReqs(arr);
  };

  const saveReqs = async () => {
    try {
      // Siapkan payload untuk API
      const payload = {
        unit_kerja: selectedAudit,
        penugasan_list: tempReqs.map(req => ({
          id: req.id,
          nama_penugasan: req.name,
          kriteria: req.kriteria
        }))
      };

      // Coba simpan ke backend
      try {
        await api.post('/penugasan-kompetensi', payload);
        console.log('Data berhasil disimpan ke server');
      } catch (apiError) {
        console.warn('Gagal menyimpan ke server, menggunakan localStorage sebagai backup', apiError);
        // Fallback: simpan ke localStorage jika API gagal
        localStorage.setItem('kompetensiWajibMap', JSON.stringify({ ...kompetensiWajibMap, [selectedAudit]: tempReqs }));
      }

      // Update state lokal
      const updatedMap = { ...kompetensiWajibMap, [selectedAudit]: tempReqs };
      setKompetensiWajibMap(updatedMap);
      
      setShowEditReqModal(false);
      alert('Topik Penugasan Audit berhasil disimpan.');
    } catch (error) {
      console.error('Gagal menyimpan penugasan kompetensi', error);
      alert('Gagal menyimpan data. Silakan coba lagi.');
    }
  };

  const handleViewProfile = (auditor: typeof allUsers[0]) => {
    const userDiklats = allDiklat.filter(d => d.user_id === auditor.id);

    const competencies = userDiklats.map((d: any) => {
      let stat = 'DIRENCANAKAN';
      if (d.tanggal_expired && d.tanggal_expired !== '-') {
        stat = calculateStatus(d.tanggal_expired);
      } else if (d.sertifikat_path) {
        stat = 'Berlaku Selamanya';
      }

      return {
        id: d.id,
        year: d.tahun,
        type: d.jenis,
        kategori: d.kategori_sertifikat || 'Sertifikat Kepesertaan',
        name: (d.realisasi_diklat && d.realisasi_diklat !== '-') ? d.realisasi_diklat : 
              (d.rencana_diklat && d.rencana_diklat !== '-') ? d.rencana_diklat : '-',
        status: stat,
        certNumber: d.nomor_sertifikat || '-',
        fileLink: d.sertifikat_path ? `${STORAGE_URL}/${d.sertifikat_path}` : null,
        isPlanned: !!d.rencana_diklat && d.rencana_diklat !== '-', 
        isRealized: !!d.realisasi_diklat && d.realisasi_diklat !== '-' 
      };
    });

    setSelectedProfile({
      id: auditor.id,
      company: auditor.instansi || 'Belum Diatur',
      name: auditor.nama,
      pos: auditor.jabatan || 'Auditor',
      unit: auditor.unit_kerja || 'Unit Kerja',
      status: auditor.status_kepegawaian || 'Pegawai Tetap',
      np: auditor.np || '-',
      avatar: auditor.nama?.charAt(0).toUpperCase() || 'A',
      photo: auditor.photo ? `${STORAGE_URL}/${auditor.photo}` : null,
      investasi: 'Rp 0',
      email: auditor.email || '-',
      competencies: competencies
    });

    setIsProfileModalOpen(true);
    setProfileYearFilter('Semua');
  };

  const getDropdownStyle = (status: StatusKelayakan) => {
    switch (status) {
      case 'Layak Ditugaskan': return 'bg-[#dcfce7] text-[#166534] border-[#bbf7d0]';
      case 'Perlu Penguatan': return 'bg-[#ffedd5] text-[#9a3412] border-[#fed7aa]';
      case 'Tidak Direkomendasikan': return 'bg-[#fee2e2] text-[#991b1b] border-[#fecaca]';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const handleViewDocument = (c: any) => {
    if (!c.fileLink || c.fileLink === '-') return;

    const ext = c.fileLink.split('.').pop()?.toLowerCase();
    setPreviewFileData({
      fileName: c.fileLink.split('/').pop() || 'Sertifikat',
      fileUrl: c.fileLink,
      fileType: (ext === 'pdf') ? 'pdf' : 'image'
    });
    setIsPreviewModalOpen(true);
  };

  const currentAuditors = allUsers.filter(u => u.unit_kerja === selectedAudit);
  const currentReqs = kompetensiWajibMap[selectedAudit] || [];

  return (
    <div className="bg-[#f4f6f9] min-h-screen -m-6 sm:-m-8 relative font-sans">
      <div className="bg-[#0b3c5d] text-white px-8 py-6">
        <h1 className="text-xl font-bold mb-1">SI-PAKAR – Penugasan Audit Berbasis Kompetensi</h1>
        <p className="text-xs text-blue-100">Pemetaan dan Rekomendasi Personel Berdasarkan Unit Kerja</p>
      </div>

      <div className="p-8 space-y-6">
        {/* Card Pilih Unit Kerja Penugasan */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Pilih Penugasan Audit (Berdasarkan Unit Kerja)</h2>
          <div className="flex flex-wrap gap-2">
            {unitKerjas.length > 0 ? unitKerjas.map((unit) => (
              <button
                key={unit}
                onClick={() => setSelectedAudit(unit)}
                className={`px-4 py-2 rounded text-sm font-semibold transition-colors ${
                  selectedAudit === unit ? 'bg-[#0b3c5d] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {unit}
              </button>
            )) : (
              <p className="text-sm text-gray-500 italic">Mencari data Unit Kerja...</p>
            )}
          </div>
        </div>

        {/* Card Topik Penugasan / Sub-Audit */}
        {selectedAudit && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 flex flex-col items-start relative">
            <div className="flex justify-between items-center w-full mb-4">
              <h2 className="text-lg font-bold text-gray-900">
                Topik Penugasan Audit untuk <span className="text-[#0b3c5d]">{selectedAudit}</span>
              </h2>
              {user?.role !== 'Manajemen' && (
                <button 
                  onClick={openReqModal}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-sm font-semibold transition-colors"
                >
                  <Edit className="w-4 h-4" /> Manajemen Penugasan
                </button>
              )}
            </div>
            
            {currentReqs.length > 0 ? (
              <div className="w-full">
                <div className="flex flex-wrap gap-2 border-b border-gray-100 pb-4 mb-4">
                  {currentReqs.map((req) => (
                    <button
                      key={req.id}
                      onClick={() => setSelectedSubAudit(req.id)}
                      className={`px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition-colors ${
                        selectedSubAudit === req.id 
                          ? 'border-blue-600 text-blue-600 bg-blue-50/50' 
                          : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                      }`}
                    >
                      {req.name}
                    </button>
                  ))}
                </div>
                
                {selectedSubAudit && (
                  <div className="bg-blue-50/50 rounded-lg p-4 border border-blue-100/50">
                    <h3 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-1">Keterangan / Kriteria Penugasan:</h3>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">
                      {currentReqs.find(r => r.id === selectedSubAudit)?.kriteria || 'Tidak ada keterangan khusus.'}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                <p className="text-sm text-gray-500 font-medium">Belum ada topik penugasan yang didaftarkan untuk unit kerja ini.</p>
                <p className="text-xs text-gray-400 mt-1">Silakan klik "Manajemen Penugasan" untuk menambahkan.</p>
              </div>
            )}
          </div>
        )}

        {/* Tabel Evaluasi Penugasan Utama */}
        {selectedAudit && selectedSubAudit && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 overflow-hidden">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              Evaluasi Personel untuk <span className="text-[#0b3c5d]">{currentReqs.find(r => r.id === selectedSubAudit)?.name}</span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="bg-[#0b3c5d] text-white">
                    <th className="px-4 py-3 font-semibold">Auditor</th>
                    <th className="px-4 py-3 font-semibold">Jabatan</th>
                    <th className="px-4 py-3 font-semibold">Instansi</th>
                    <th className="px-4 py-3 font-semibold text-center w-56">Status Kelayakan</th>
                    <th className="px-4 py-3 font-semibold">Keterangan</th>
                    <th className="px-4 py-3 font-semibold text-center w-24">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {currentAuditors.length > 0 ? (
                    currentAuditors.map((auditor) => {
                      const status = evaluationStatuses[selectedAudit]?.[selectedSubAudit]?.[auditor.id] || 'Perlu Penguatan';

                      return (
                        <tr key={auditor.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex flex-col">
                              <span className="text-gray-900 font-bold">{auditor.nama}</span>
                              <span className="text-xs text-gray-400 font-semibold">{auditor.np || '-'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-700">{auditor.jabatan || '-'}</td>
                          <td className="px-4 py-3 text-gray-700">{auditor.instansi || '-'}</td>
                          <td className="px-4 py-3 text-center">
                            <select
                              value={status}
                              disabled={user?.role === 'Manajemen'}
                              onChange={(e) => handleStatusChange(auditor.id, e.target.value as StatusKelayakan)}
                              className={`w-full text-xs font-bold px-3 py-1.5 rounded-full border outline-none ${user?.role === 'Manajemen' ? 'cursor-not-allowed opacity-90' : 'cursor-pointer'} text-center appearance-none text-center-last transition-colors ${getDropdownStyle(status)}`}
                              style={{ textAlignLast: 'center' }}
                            >
                              <option value="Layak Ditugaskan" className="bg-white text-gray-900">Layak Ditugaskan</option>
                              <option value="Perlu Penguatan" className="bg-white text-gray-900">Perlu Penguatan</option>
                              <option value="Tidak Direkomendasikan" className="bg-white text-gray-900">Tidak Direkomendasikan</option>
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <input 
                              type="text"
                              value={keteranganMap[selectedAudit]?.[selectedSubAudit]?.[auditor.id] || ''}
                              onChange={(e) => handleKeteranganChange(auditor.id, e.target.value)}
                              disabled={user?.role === 'Manajemen'}
                              placeholder="Keterangan..."
                              className={`w-full min-w-[120px] px-3 py-1.5 text-xs rounded-lg border border-gray-200 outline-none focus:ring-1 focus:ring-blue-500 transition-colors ${user?.role === 'Manajemen' ? 'bg-gray-50 cursor-not-allowed' : 'bg-white'}`}
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button 
                              onClick={() => handleViewProfile(auditor)}
                              className="text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg font-bold transition-all"
                            >
                              Klik
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500 bg-gray-50/50">
                        {loading ? 'Memuat data personel...' : `Tidak ada auditor yang terdaftar di Unit Kerja ${selectedAudit}.`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* MODAL EDIT PENUGASAN WAJIB */}
      {showEditReqModal && (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-lg font-bold text-gray-900">Manajemen Topik Penugasan</h2>
              <button onClick={() => setShowEditReqModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-4">Edit topik penugasan audit untuk unit kerja <strong>{selectedAudit}</strong>.</p>
              
              <div className="flex flex-col gap-2 mb-4 bg-blue-50/50 p-4 rounded-lg border border-blue-100">
                <input 
                  type="text" 
                  value={newReqName} 
                  onChange={(e) => setNewReqName(e.target.value)} 
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-semibold"
                  placeholder="Nama Penugasan (Contoh: Audit BGN)"
                />
                <textarea 
                  value={newReqKriteria} 
                  onChange={(e) => setNewReqKriteria(e.target.value)} 
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none h-20"
                  placeholder="Keterangan / Kriteria Penugasan..."
                />
                <button 
                  onClick={addReq}
                  className="mt-2 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors flex justify-center items-center gap-1"
                >
                  <Plus className="w-4 h-4" /> Tambah Penugasan
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2 border border-gray-100 rounded-lg p-2 bg-gray-50">
                {tempReqs.map((req, index) => (
                  <div key={req.id || index} className="flex flex-col bg-white p-3 rounded-lg shadow-sm border border-gray-200 relative group">
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-sm font-bold text-gray-800">{req.name}</span>
                      <button onClick={() => removeReq(index)} className="text-red-400 hover:text-red-600 p-1">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <span className="text-xs text-gray-500">{req.kriteria}</span>
                  </div>
                ))}
                {tempReqs.length === 0 && (
                  <p className="text-center text-gray-400 text-sm italic py-4">Belum ada kompetensi terdaftar.</p>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button 
                onClick={() => setShowEditReqModal(false)}
                className="px-4 py-2 text-gray-600 font-semibold hover:bg-gray-200 rounded-lg transition-colors text-sm"
              >
                Batal
              </button>
              <button 
                onClick={saveReqs}
                className="px-6 py-2 bg-[#0b3c5d] hover:bg-blue-800 text-white font-bold rounded-lg shadow-md transition-colors text-sm"
              >
                Simpan Konfigurasi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PROFIL PERSONEL (100% PERSIS PROFIL KOMPETENSI) */}
      {isProfileModalOpen && selectedProfile && (() => {
        // PERUBAHAN: Menampilkan semua program, bukan hanya yang "validComps"
        const allCompsOriginal = selectedProfile.competencies || []; 
        const profileAvailableYears = ['Semua', ...Array.from(new Set(allCompsOriginal.map((c: any) => c.year).filter(Boolean))).sort((a: any, b: any) => b - a)] as string[];
        
        const allComps = profileYearFilter === 'Semua' ? allCompsOriginal : allCompsOriginal.filter((c: any) => c.year == profileYearFilter);

        const realizedComps = allComps.filter((c: any) => c.isRealized);
        const plannedComps = allComps.filter((c: any) => c.isPlanned);
        
        const totalPlanned = plannedComps.length;
        const totalRealized = realizedComps.length;
        const targetRealizedPercent = totalPlanned > 0 ? Math.min(Math.round((totalRealized / totalPlanned) * 100), 100) : (totalRealized > 0 ? 100 : 0);

        // Untuk chart tetap menggunakan validComps (yang ada sertifikat) agar perhitungannya akurat
        const validComps = allComps.filter((c: any) => c.status !== 'DIRENCANAKAN');
        const totalValid = validComps.length;

        // Perhitungan: sertifikat dengan status 'Berlaku Selamanya' dihitung sebagai Aktif
        const countAktif = validComps.filter((c: any) => c.status === 'Aktif' || c.status === 'Berlaku Selamanya').length;
        const aktifPercent = totalValid > 0 ? Math.round((countAktif / totalValid) * 100) : 0;

        const countHampirExpired = validComps.filter((c: any) => c.status === 'Hampir Expired').length;
        const hampirExpiredPercent = totalValid > 0 ? Math.round((countHampirExpired / totalValid) * 100) : 0;

        const countExpired = validComps.filter((c: any) => c.status === 'Expired').length;
        const expiredPercent = totalValid > 0 ? Math.round((countExpired / totalValid) * 100) : 0;

        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div 
              className="bg-[#f8fafc] w-full max-w-7xl h-[90vh] rounded-3xl shadow-2xl overflow-hidden flex relative animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <button 
                onClick={() => { setIsProfileModalOpen(false); setProfileYearFilter('Semua'); }} 
                className="absolute top-5 right-5 z-20 p-2 bg-white hover:bg-gray-100 text-gray-500 rounded-full shadow-sm transition-all"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="w-[300px] bg-white border-r border-gray-200 p-6 flex flex-col shrink-0 overflow-y-auto custom-scrollbar">
                
                <div className="flex flex-col items-center text-center mt-6 mb-8">
                  <div className="w-32 h-32 rounded-full overflow-hidden bg-gray-100 mb-4 border border-gray-200">
                    {selectedProfile.photo ? (
                      <img src={selectedProfile.photo} alt={selectedProfile.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="flex items-center justify-center h-full text-4xl font-bold text-gray-400">{selectedProfile.avatar}</span>
                    )}
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">{selectedProfile.name}</h2>
                  <p className="text-sm text-gray-500 mt-1 capitalize">{selectedProfile.pos.toLowerCase()}</p>
                </div>

                <div className="space-y-3">
                  <div className="bg-[#f0f4f8] rounded-lg p-3 text-[13px]">
                    <span className="text-gray-500">Unit:</span> <span className="font-semibold text-gray-800 ml-1">{selectedProfile.unit}</span>
                  </div>
                  
                  <div className="bg-[#f0f4f8] rounded-lg p-3 text-[13px]">
                    <span className="text-gray-500">Total Program:</span> 
                    <span className="font-semibold text-gray-800 ml-1">
                      {allComps.length}
                    </span>
                  </div>
                  
                  <div className="bg-[#f0f4f8] rounded-lg p-3 text-[13px]">
                    <span className="text-gray-500">Status:</span> <span className="font-semibold text-gray-800 ml-1">{selectedProfile.status}</span>
                  </div>
                </div>
              </div>

              <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
                
                <div className="flex justify-between items-center mb-6 pr-10">
                  <h3 className="text-xl font-bold text-gray-900">Ringkasan Kompetensi</h3>
                  <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm">
                    <span className="text-sm font-semibold text-gray-500">Tahun:</span>
                    <select 
                      value={profileYearFilter}
                      onChange={(e) => setProfileYearFilter(e.target.value)}
                      className="bg-transparent text-gray-900 font-bold text-sm outline-none cursor-pointer border-none focus:ring-0 p-0"
                    >
                      {profileAvailableYears.map(y => (
                        <option key={y} value={y}>{y === 'Semua' ? 'Semua Tahun' : y}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                  
                  <CircularProgress 
                    title="Target vs Realisasi Kompetensi" 
                    valueText={`${targetRealizedPercent}%`} 
                    percentage={targetRealizedPercent} 
                  />

                  <CircularProgress 
                    title="Sertifikat Aktif" 
                    valueText={countAktif.toString()} 
                    percentage={aktifPercent} 
                  />

                  <CircularProgress 
                    title="Sertifikat Hampir Expired" 
                    valueText={countHampirExpired.toString()} 
                    percentage={hampirExpiredPercent} 
                  />

                  <CircularProgress 
                    title="Sertifikat Expired" 
                    valueText={countExpired.toString()} 
                    percentage={expiredPercent} 
                  />

                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-100">
                    <h3 className="font-bold text-lg text-gray-900">Daftar Riwayat Program & Sertifikat</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-[#1e3a8a] text-white">
                        <tr>
                            <th className="px-6 py-4 font-semibold text-center w-1/3">Nama Program / Sertifikat</th>
                            <th className="px-6 py-4 font-semibold text-center">Jenis Program</th>
                            <th className="px-6 py-4 font-semibold text-center">Kategori</th>
                            <th className="px-6 py-4 font-semibold text-center">Tahun</th>
                            <th className="px-6 py-4 font-semibold text-center">Status</th>
                            <th className="px-6 py-4 font-semibold text-center">File</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {allComps.map((c: any) => {
                          
                          let badgeText = c.status;
                          let badgeStyle = "bg-slate-100 text-slate-700";

                          if (c.status === 'Aktif') {
                            badgeStyle = "bg-green-100 text-green-700";
                          } else if (c.status === 'Berlaku Selamanya') {
                            badgeStyle = "bg-emerald-100 text-emerald-700";
                          } else if (c.status === 'Hampir Expired') {
                            badgeStyle = "bg-amber-100 text-amber-700";
                          } else if (c.status === 'Expired') {
                            badgeStyle = "bg-red-100 text-red-700";
                          } else if (c.status === 'DIRENCANAKAN') {
                            if (c.isRealized) {
                              badgeText = "Menunggu Sertifikat";
                              badgeStyle = "bg-slate-100 text-slate-600"; 
                            } else {
                              badgeText = "Direncanakan";
                              badgeStyle = "bg-blue-50 text-blue-500 border border-blue-100";
                            }
                          }

                          return (
                            <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-6 py-4 font-medium text-gray-800">{c.name}</td>
                              <td className="px-6 py-4 text-center text-gray-600">{c.type}</td>
                              <td className="px-6 py-4 text-center text-gray-600">
                                <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${c.kategori === 'Sertifikat Profesi' ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-700 border border-slate-200'}`}>
                                  {c.kategori ? c.kategori.replace('Sertifikat ', '') : 'Kepesertaan'}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-center text-gray-600">{c.year}</td>
                              <td className="px-6 py-4 text-center">
                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${badgeStyle}`}>
                                  {badgeText}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-center">
                                {c.fileLink && c.fileLink !== '-' ? (
                                  <button 
                                    onClick={() => handleViewDocument(c)}
                                    className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-semibold transition-colors shadow-sm"
                                  >
                                    Lihat
                                  </button>
                                ) : (
                                  <span className="text-gray-400 text-xs italic">Tidak ada file</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}

                        {allComps.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-6 py-8 text-center text-gray-500 italic">
                              Tidak ada riwayat program untuk auditor ini.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL PREVIEW PDF/GAMBAR */}
      {isPreviewModalOpen && previewFileData && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-gray-200 flex justify-between items-center bg-gradient-to-r from-blue-600 to-blue-700 text-white">
              <h2 className="text-lg font-bold flex items-center space-x-2">
                <Upload className="w-5 h-5" />
                <span>Preview: {previewFileData.fileName}</span>
              </h2>
              <button 
                onClick={() => setIsPreviewModalOpen(false)}
                className="p-2 hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto flex items-center justify-center bg-gray-50 p-6 min-h-[500px]">
              {previewFileData.fileType === 'pdf' ? (
                <iframe
                  src={previewFileData.fileUrl}
                  className="w-full h-full border-0 rounded-lg shadow-lg"
                  title="PDF Preview"
                />
              ) : (
                <img
                  src={previewFileData.fileUrl}
                  alt={previewFileData.fileName}
                  className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-lg"
                />
              )}
            </div>

            <div className="p-5 border-t border-gray-200 bg-gray-50 flex justify-between items-center">
              <div className="text-xs text-gray-600">
                <span className="font-semibold">Sistem Penyimpanan Terpadu SI-PAKAR</span>
              </div>
              <button
                onClick={() => handleDownloadFile(previewFileData.fileUrl, previewFileData.fileName)}
                disabled={isDownloading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors flex items-center space-x-2 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>{isDownloading ? 'Mengunduh...' : 'Unduh File'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

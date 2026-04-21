// ============================================
// MOCK DATA - Sistem HRM Perusahaan
// (Pegawai, Level, Jabatan sudah di Supabase)
// ============================================

// Attendance Records
export interface AttendanceRecord {
  id: string;
  employeeName: string;
  department: string;
  date: string;
  checkIn: string;
  checkOut: string;
  status: string;
  workHours: string;
}

export const attendanceRecords: AttendanceRecord[] = [
  {
    id: "ATT-001",
    employeeName: "Budi Santoso",
    department: "Engineering",
    date: "2024-03-18",
    checkIn: "08:02",
    checkOut: "17:15",
    status: "Hadir",
    workHours: "9j 13m",
  },
  {
    id: "ATT-002",
    employeeName: "Siti Nurhaliza",
    department: "Marketing",
    date: "2024-03-18",
    checkIn: "07:55",
    checkOut: "17:30",
    status: "Hadir",
    workHours: "9j 35m",
  },
  {
    id: "ATT-003",
    employeeName: "Ahmad Fauzi",
    department: "Sales",
    date: "2024-03-18",
    checkIn: "08:30",
    checkOut: "17:00",
    status: "Terlambat",
    workHours: "8j 30m",
  },
  {
    id: "ATT-004",
    employeeName: "Dewi Lestari",
    department: "HR",
    date: "2024-03-18",
    checkIn: "08:00",
    checkOut: "17:05",
    status: "Hadir",
    workHours: "9j 5m",
  },
  {
    id: "ATT-005",
    employeeName: "Rizky Pratama",
    department: "Engineering",
    date: "2024-03-18",
    checkIn: "07:45",
    checkOut: "18:00",
    status: "Hadir",
    workHours: "10j 15m",
  },
  {
    id: "ATT-006",
    employeeName: "Maya Anggraini",
    department: "Finance",
    date: "2024-03-18",
    checkIn: "-",
    checkOut: "-",
    status: "Izin",
    workHours: "-",
  },
  {
    id: "ATT-007",
    employeeName: "Hendra Wijaya",
    department: "Operations",
    date: "2024-03-18",
    checkIn: "08:10",
    checkOut: "17:20",
    status: "Hadir",
    workHours: "9j 10m",
  },
  {
    id: "ATT-008",
    employeeName: "Putri Rahayu",
    department: "Design",
    date: "2024-03-18",
    checkIn: "-",
    checkOut: "-",
    status: "Sakit",
    workHours: "-",
  },
];

// Payroll Data
export interface PayrollRecord {
  id: string;
  employeeName: string;
  department: string;
  position: string;
  baseSalary: number;
  allowance: number;
  deduction: number;
  netSalary: number;
  status: string;
  period: string;
}

export const payrollRecords: PayrollRecord[] = [
  {
    id: "PAY-001",
    employeeName: "Budi Santoso",
    department: "Engineering",
    position: "Senior Software Engineer",
    baseSalary: 25000000,
    allowance: 5000000,
    deduction: 2500000,
    netSalary: 27500000,
    status: "Paid",
    period: "Maret 2024",
  },
  {
    id: "PAY-002",
    employeeName: "Siti Nurhaliza",
    department: "Marketing",
    position: "Marketing Manager",
    baseSalary: 22000000,
    allowance: 4500000,
    deduction: 2200000,
    netSalary: 24300000,
    status: "Paid",
    period: "Maret 2024",
  },
  {
    id: "PAY-003",
    employeeName: "Ahmad Fauzi",
    department: "Sales",
    position: "Sales Executive",
    baseSalary: 18000000,
    allowance: 3500000,
    deduction: 1800000,
    netSalary: 19700000,
    status: "Pending",
    period: "Maret 2024",
  },
  {
    id: "PAY-004",
    employeeName: "Dewi Lestari",
    department: "HR",
    position: "HR Specialist",
    baseSalary: 16000000,
    allowance: 3000000,
    deduction: 1600000,
    netSalary: 17400000,
    status: "Paid",
    period: "Maret 2024",
  },
  {
    id: "PAY-005",
    employeeName: "Rizky Pratama",
    department: "Engineering",
    position: "Frontend Developer",
    baseSalary: 20000000,
    allowance: 4000000,
    deduction: 2000000,
    netSalary: 22000000,
    status: "Pending",
    period: "Maret 2024",
  },
  {
    id: "PAY-006",
    employeeName: "Hendra Wijaya",
    department: "Operations",
    position: "Operations Manager",
    baseSalary: 28000000,
    allowance: 6000000,
    deduction: 2800000,
    netSalary: 31200000,
    status: "Paid",
    period: "Maret 2024",
  },
];

// Leave Requests
export interface LeaveRequest {
  id: string;
  employeeName: string;
  department: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  reason: string;
}

export const leaveRequests: LeaveRequest[] = [
  {
    id: "LV-001",
    employeeName: "Ahmad Fauzi",
    department: "Sales",
    type: "Cuti Tahunan",
    startDate: "2024-03-20",
    endDate: "2024-03-22",
    days: 3,
    status: "Pending",
    reason: "Acara keluarga",
  },
  {
    id: "LV-002",
    employeeName: "Putri Rahayu",
    department: "Design",
    type: "Cuti Sakit",
    startDate: "2024-03-18",
    endDate: "2024-03-19",
    days: 2,
    status: "Approved",
    reason: "Pemeriksaan kesehatan",
  },
  {
    id: "LV-003",
    employeeName: "Budi Santoso",
    department: "Engineering",
    type: "Cuti Tahunan",
    startDate: "2024-04-01",
    endDate: "2024-04-05",
    days: 5,
    status: "Pending",
    reason: "Liburan keluarga",
  },
  {
    id: "LV-004",
    employeeName: "Siti Nurhaliza",
    department: "Marketing",
    type: "Izin",
    startDate: "2024-03-25",
    endDate: "2024-03-25",
    days: 1,
    status: "Approved",
    reason: "Urusan pribadi",
  },
  {
    id: "LV-005",
    employeeName: "Hendra Wijaya",
    department: "Operations",
    type: "Cuti Tahunan",
    startDate: "2024-03-28",
    endDate: "2024-03-29",
    days: 2,
    status: "Rejected",
    reason: "Jadwal proyek padat",
  },
  {
    id: "LV-006",
    employeeName: "Rizky Pratama",
    department: "Engineering",
    type: "Izin",
    startDate: "2024-04-08",
    endDate: "2024-04-08",
    days: 1,
    status: "Pending",
    reason: "Keperluan keluarga",
  },
  {
    id: "LV-007",
    employeeName: "Maya Anggraini",
    department: "Finance",
    type: "Cuti Sakit",
    startDate: "2024-03-15",
    endDate: "2024-03-16",
    days: 2,
    status: "Approved",
    reason: "Sakit demam",
  },
  {
    id: "LV-008",
    employeeName: "Fajar Nugroho",
    department: "Sales",
    type: "Cuti Tahunan",
    startDate: "2024-04-15",
    endDate: "2024-04-19",
    days: 5,
    status: "Pending",
    reason: "Pernikahan saudara",
  },
];

// Recruitment / Candidates
export interface Candidate {
  id: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  appliedDate: string;
  status: string;
  stage: string;
  experience: string;
  education: string;
  source: string;
}

export const candidates: Candidate[] = [
  {
    id: "CND-001",
    name: "Dimas Aditya",
    email: "dimas.aditya@gmail.com",
    phone: "+62 856-1234-5678",
    position: "Full Stack Developer",
    department: "Engineering",
    appliedDate: "2024-03-10",
    status: "Active",
    stage: "Interview HR",
    experience: "4 tahun",
    education: "S1 Teknik Informatika",
    source: "LinkedIn",
  },
  {
    id: "CND-002",
    name: "Anisa Rahma",
    email: "anisa.rahma@gmail.com",
    phone: "+62 857-2345-6789",
    position: "Digital Marketing Specialist",
    department: "Marketing",
    appliedDate: "2024-03-12",
    status: "Active",
    stage: "Interview User",
    experience: "3 tahun",
    education: "S1 Ilmu Komunikasi",
    source: "JobStreet",
  },
  {
    id: "CND-003",
    name: "Rendi Kurniawan",
    email: "rendi.k@gmail.com",
    phone: "+62 858-3456-7890",
    position: "Backend Developer",
    department: "Engineering",
    appliedDate: "2024-03-08",
    status: "Active",
    stage: "Technical Test",
    experience: "2 tahun",
    education: "S1 Sistem Informasi",
    source: "Referral",
  },
  {
    id: "CND-004",
    name: "Fitri Handayani",
    email: "fitri.h@gmail.com",
    phone: "+62 859-4567-8901",
    position: "UI/UX Designer",
    department: "Design",
    appliedDate: "2024-03-15",
    status: "Active",
    stage: "Review Portfolio",
    experience: "5 tahun",
    education: "S1 Desain Komunikasi Visual",
    source: "Website Karir",
  },
  {
    id: "CND-005",
    name: "Galih Pratama",
    email: "galih.p@gmail.com",
    phone: "+62 851-5678-9012",
    position: "Sales Executive",
    department: "Sales",
    appliedDate: "2024-03-05",
    status: "Offered",
    stage: "Offering",
    experience: "3 tahun",
    education: "S1 Manajemen",
    source: "LinkedIn",
  },
  {
    id: "CND-006",
    name: "Nadia Putri",
    email: "nadia.putri@gmail.com",
    phone: "+62 852-6789-0123",
    position: "HR Generalist",
    department: "HR",
    appliedDate: "2024-03-18",
    status: "Active",
    stage: "Screening CV",
    experience: "2 tahun",
    education: "S1 Psikologi",
    source: "Glints",
  },
  {
    id: "CND-007",
    name: "Bayu Setiawan",
    email: "bayu.s@gmail.com",
    phone: "+62 853-7890-1234",
    position: "DevOps Engineer",
    department: "Engineering",
    appliedDate: "2024-02-28",
    status: "Rejected",
    stage: "Interview HR",
    experience: "3 tahun",
    education: "S1 Teknik Informatika",
    source: "LinkedIn",
  },
  {
    id: "CND-008",
    name: "Citra Dewi",
    email: "citra.dewi@gmail.com",
    phone: "+62 854-8901-2345",
    position: "Financial Analyst",
    department: "Finance",
    appliedDate: "2024-03-20",
    status: "Active",
    stage: "Interview HR",
    experience: "4 tahun",
    education: "S1 Akuntansi",
    source: "JobStreet",
  },
  {
    id: "CND-009",
    name: "Eko Prasetyo",
    email: "eko.p@gmail.com",
    phone: "+62 855-9012-3456",
    position: "Project Manager",
    department: "Operations",
    appliedDate: "2024-03-01",
    status: "Hired",
    stage: "Onboarding",
    experience: "7 tahun",
    education: "S2 Manajemen Proyek",
    source: "Referral",
  },
  {
    id: "CND-010",
    name: "Laras Wulandari",
    email: "laras.w@gmail.com",
    phone: "+62 856-0123-4567",
    position: "Content Writer",
    department: "Marketing",
    appliedDate: "2024-03-22",
    status: "Active",
    stage: "Screening CV",
    experience: "1 tahun",
    education: "S1 Sastra Inggris",
    source: "Website Karir",
  },
];

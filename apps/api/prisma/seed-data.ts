/**
 * WINDGUARD demonstration data. Everything created here is clearly sample data for a
 * fictional security contractor; it is regenerated relative to "now" so the dashboard
 * always shows a live-looking day. Run: npm run db:seed (wipes existing data); see seed.ts.
 */
import bcrypt from 'bcryptjs';
import { DateTime } from 'luxon';
import { PrismaClient, type AttendanceStatus, type EntryMode, type Prisma } from '../src/generated/prisma/client';
import { derive } from '../src/modules/attendance/attendance.engine';
import { DEFAULT_ABBREVIATIONS } from '../src/common/org.service';
import { addDays, dateOnly, shiftWindow, todayIn, weekday } from '../src/common/time';

let prisma: PrismaClient;
const TZ = 'Asia/Kolkata';
const PASSWORD = 'Windguard@2026';
const HISTORY_DAYS = 120;

// Deterministic PRNG so demo data is stable between seeds.
let seed = 20261121;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
const between = (a: number, b: number) => Math.round(a + rand() * (b - a));

const FIRST = ['Ramesh', 'Suresh', 'Mahesh', 'Dinesh', 'Jignesh', 'Bharat', 'Kishore', 'Raju', 'Prakash', 'Arvind', 'Hitesh', 'Mukesh', 'Naresh', 'Vipul', 'Kalpesh', 'Ganesh', 'Manoj', 'Sanjay', 'Ajay', 'Vijay', 'Rakesh', 'Deepak', 'Pankaj', 'Lalit', 'Jitendra', 'Bhavesh', 'Nilesh', 'Paresh', 'Chirag', 'Sunil'];
const LAST_GJ = ['Patel', 'Chavda', 'Solanki', 'Parmar', 'Jadeja', 'Rathod', 'Makwana', 'Vaghela', 'Gohil', 'Bhatt', 'Sodha', 'Ahir', 'Rabari', 'Desai', 'Chauhan'];
const FIRST_TN = ['Murugan', 'Selvam', 'Karthik', 'Saravanan', 'Ganesan', 'Arumugam', 'Senthil', 'Pandian', 'Rajesh', 'Vignesh', 'Subramani', 'Ilango', 'Manikandan', 'Velu', 'Anbu', 'Kannan', 'Muthu', 'Prabhu'];
const LAST_TN = ['Selvaraj', 'Pillai', 'Nadar', 'Thevar', 'Raman', 'Krishnan', 'Subbiah', 'Perumal', 'Muthusamy', 'Ramasamy', 'Arumugam', 'Chelladurai'];
const FIRST_RJ = ['Mahendra', 'Bhanwar', 'Narpat', 'Jethu', 'Sawai', 'Gopal', 'Bhagirath', 'Hanuman', 'Kailash', 'Om', 'Shyam', 'Ramesh', 'Sohan', 'Devi', 'Ladu', 'Chhagan', 'Moti', 'Pappu'];
const LAST_RJ = ['Singh Bhati', 'Singh Rathore', 'Ram Meghwal', 'Lal Choudhary', 'Singh Chauhan', 'Ram Jat', 'Lal Mali', 'Singh Shekhawat', 'Ram Bishnoi', 'Khan', 'Prasad Sharma'];
const FEMALE = ['Kavita', 'Sunita', 'Meena', 'Lakshmi', 'Geeta', 'Anjali', 'Revathi', 'Pooja'];

const DESIGNATIONS = [
  { name: 'Security Guard', weight: 58 },
  { name: 'Senior Security Guard', weight: 12 },
  { name: 'Head Guard', weight: 6 },
  { name: 'Armed Guard (Gunman)', weight: 6 },
  { name: 'Lady Security Guard', weight: 6 },
  { name: 'Fire Watchman', weight: 6 },
  { name: 'Patrolling Supervisor', weight: 6 },
];
const DEPT: Record<string, string> = {
  'Fire Watchman': 'Fire & Safety',
  'Patrolling Supervisor': 'Security Operations',
};

function weightedDesignation() {
  const total = DESIGNATIONS.reduce((a, d) => a + d.weight, 0);
  let r = rand() * total;
  for (const d of DESIGNATIONS) {
    r -= d.weight;
    if (r <= 0) return d.name;
  }
  return DESIGNATIONS[0].name;
}

const phone = () => `${pick(['9', '8', '7', '6'])}${String(between(100000000, 999999999)).padStart(9, '0')}`;

async function wipe() {
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  // TRUNCATE bypasses the row-level append-only trigger on AuditLog (intentional for reseeding only).
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
}

async function main() {
  console.log('Seeding WINDGUARD demo data…');
  await wipe();
  const hash = await bcrypt.hash(PASSWORD, 10);
  const today = todayIn(TZ);
  const now = Date.now();

  // ───────── Organizations ─────────
  const org = await prisma.organization.create({
    data: {
      name: 'Saurashtra Wind Security Services (Demo)',
      code: 'SWSS',
      legalName: 'Saurashtra Wind Security Services Pvt. Ltd. — sample organization',
      address: 'Plot 14, GIDC Estate, Bhuj, Kutch, Gujarat 370001',
      timezone: TZ,
      settings: { create: { abbreviations: DEFAULT_ABBREVIATIONS, overtimeThresholdMins: 30, halfDayThresholdMins: 240, incompleteAfterHours: 2 } },
    },
  });
  const org2 = await prisma.organization.create({
    data: {
      name: 'Deccan Renewables Facility Services (Demo)',
      code: 'DRFS',
      address: 'Chitradurga, Karnataka',
      timezone: TZ,
      settings: { create: { abbreviations: DEFAULT_ABBREVIATIONS } },
    },
  });

  // ───────── Projects & sites ─────────
  const projects = {
    kutch: await prisma.project.create({ data: { organizationId: org.id, name: 'Kutch Wind Cluster – Phase II', code: 'KWC2', capacityMw: 300, description: '120 × 2.5 MW WTGs with 66/220 kV pooling substation' } }),
    tn: await prisma.project.create({ data: { organizationId: org.id, name: 'Muppandal–Aralvaimozhi Wind Belt', code: 'MAWB', capacityMw: 180, description: 'Legacy WTG belt and 110 kV evacuation substation' } }),
    thar: await prisma.project.create({ data: { organizationId: org.id, name: 'Thar Wind Park', code: 'TWP', capacityMw: 250, description: 'Desert wind park with hybrid solar block' } }),
  };

  const siteDefs = [
    {
      key: 'NKT',
      project: projects.kutch.id,
      name: 'Nakhatrana Wind Farm',
      address: 'Survey No. 211, Nakhatrana–Lakhpat Road, Kutch',
      state: 'Gujarat',
      district: 'Kutch',
      locations: ['Main Security Gate', 'Control Room', 'WTG Cluster A (T01–T24)', 'WTG Cluster B (T25–T48)', '66/220 kV Pooling Substation', 'Store Yard'],
      required: [8, 7, 6],
      employees: 32,
      names: [FIRST, LAST_GJ],
    },
    {
      key: 'MPL',
      project: projects.tn.id,
      name: 'Muppandal Substation',
      address: 'Aralvaimozhi Main Road, Muppandal, Kanyakumari',
      state: 'Tamil Nadu',
      district: 'Kanyakumari',
      locations: ['Main Gate', 'Control Room', '110 kV Switchyard', 'WTG Row North'],
      required: [5, 5, 4],
      employees: 20,
      names: [FIRST_TN, LAST_TN],
    },
    {
      key: 'JSM',
      project: projects.thar.id,
      name: 'Jaisalmer Wind Park',
      address: 'Badabagh–Ramgarh Road, Jaisalmer',
      state: 'Rajasthan',
      district: 'Jaisalmer',
      locations: ['Entry Gate', 'Control Room', 'Turbine Area', '33/220 kV Substation'],
      required: [6, 5, 5],
      employees: 24,
      names: [FIRST_RJ, LAST_RJ],
    },
  ] as const;

  const sites: Record<string, { id: string; shifts: { id: string; code: string; startMinute: number; endMinute: number; breakMinutes: number; graceMinutes: number }[]; locations: string[] }> = {};
  for (const d of siteDefs) {
    const site = await prisma.site.create({
      data: {
        organizationId: org.id,
        projectId: d.project,
        name: d.name,
        code: d.key,
        address: d.address,
        state: d.state,
        district: d.district,
        timezone: TZ,
        locations: { create: d.locations.map((name) => ({ name, kind: /Gate/.test(name) ? 'SECURITY_GATE' : /Control/.test(name) ? 'CONTROL_ROOM' : /WTG|Turbine/.test(name) ? 'TURBINE_AREA' : /Substation|Switchyard/.test(name) ? 'SUBSTATION' : 'DEPLOYMENT_POINT' })) },
      },
      include: { locations: true },
    });
    const defs = [
      { name: 'First Shift', code: 'S1', startMinute: 360, endMinute: 840, color: '#0F9F8F' },
      { name: 'Second Shift', code: 'S2', startMinute: 840, endMinute: 1320, color: "#2A78D6" },
      { name: 'Third Shift', code: 'S3', startMinute: 1320, endMinute: 360, color: '#EB6834' },
    ];
    const shifts = [];
    for (const [i, s] of defs.entries()) {
      shifts.push(
        await prisma.shift.create({
          data: { ...s, organizationId: org.id, siteId: site.id, breakMinutes: 30, graceMinutes: 10, requiredWorkers: d.required[i], sortOrder: i + 1 },
        }),
      );
    }
    sites[d.key] = { id: site.id, shifts, locations: site.locations.map((l) => l.id) };
  }
  // A second org gets one small site so super admins can switch organizations.
  const s2 = await prisma.site.create({ data: { organizationId: org2.id, name: 'Chitradurga Wind Farm', code: 'CTA', state: 'Karnataka', district: 'Chitradurga', timezone: TZ } });
  await prisma.shift.createMany({
    data: [
      { organizationId: org2.id, siteId: s2.id, name: 'Day Shift', code: 'D', startMinute: 480, endMinute: 1200, breakMinutes: 60, graceMinutes: 15, requiredWorkers: 3, sortOrder: 1, color: '#0F9F8F' },
      { organizationId: org2.id, siteId: s2.id, name: 'Night Shift', code: 'N', startMinute: 1200, endMinute: 480, breakMinutes: 60, graceMinutes: 15, requiredWorkers: 2, sortOrder: 2, color: '#EB6834' },
    ],
  });

  // ───────── Users (application accounts — workers never get one) ─────────
  const mkUser = (data: { email: string; fullName: string; role: 'SUPER_ADMIN' | 'COMPANY_ADMIN' | 'SUPERVISOR' | 'VIEWER'; phone?: string; siteKeys?: string[]; extra?: string[]; orgId?: string }) =>
    prisma.user.create({
      data: {
        organizationId: data.orgId ?? org.id,
        email: data.email,
        fullName: data.fullName,
        phone: data.phone ?? phone(),
        role: data.role,
        passwordHash: hash,
        extraPermissions: data.extra ?? [],
        lastLoginAt: new Date(now - between(1, 48) * 3600_000),
        lastSeenAt: new Date(now - between(2, 40) * 60_000),
        siteAssignments: data.siteKeys ? { create: data.siteKeys.map((k, i) => ({ siteId: sites[k].id, isPrimary: i === 0 })) } : undefined,
      },
    });
  await mkUser({ email: 'superadmin@windguard.local', fullName: 'Rohit Mehta', role: 'SUPER_ADMIN' });
  const admin = await mkUser({ email: 'admin@windguard.local', fullName: 'Vikram Solanki', role: 'COMPANY_ADMIN' });
  await mkUser({ email: 'ops.admin@windguard.local', fullName: 'Priya Raval', role: 'COMPANY_ADMIN' });
  const supNKT = await mkUser({ email: 'supervisor@windguard.local', fullName: 'Harish Chavda', role: 'SUPERVISOR', siteKeys: ['NKT'], extra: ['roster.manage'] });
  const supNKT2 = await mkUser({ email: 'night.nkt@windguard.local', fullName: 'Jayesh Gohil', role: 'SUPERVISOR', siteKeys: ['NKT'] });
  const supMPL = await mkUser({ email: 'supervisor.mpl@windguard.local', fullName: 'Selvakumar Pandian', role: 'SUPERVISOR', siteKeys: ['MPL'] });
  const supJSM = await mkUser({ email: 'supervisor.jsm@windguard.local', fullName: 'Narendra Singh Bhati', role: 'SUPERVISOR', siteKeys: ['JSM'] });
  await mkUser({ email: 'auditor@windguard.local', fullName: 'Neha Kulkarni', role: 'VIEWER' });
  await mkUser({ email: 'admin@deccan.local', fullName: 'Shreyas Hegde', role: 'COMPANY_ADMIN', orgId: org2.id });
  const supervisorsBySite: Record<string, { id: string; fullName: string }[]> = { NKT: [supNKT, supNKT2], MPL: [supMPL], JSM: [supJSM] };
  await prisma.shift.updateMany({ where: { siteId: sites.NKT.id, code: { in: ['S1', 'S2'] } }, data: { supervisorId: supNKT.id } });
  await prisma.shift.updateMany({ where: { siteId: sites.NKT.id, code: 'S3' }, data: { supervisorId: supNKT2.id } });
  await prisma.shift.updateMany({ where: { siteId: sites.MPL.id }, data: { supervisorId: supMPL.id } });
  await prisma.shift.updateMany({ where: { siteId: sites.JSM.id }, data: { supervisorId: supJSM.id } });

  // ───────── Designations, departments ─────────
  const desig: Record<string, string> = {};
  for (const d of DESIGNATIONS) desig[d.name] = (await prisma.designation.create({ data: { organizationId: org.id, name: d.name } })).id;
  const dept: Record<string, string> = {};
  for (const n of ['Security', 'Fire & Safety', 'Security Operations']) dept[n] = (await prisma.department.create({ data: { organizationId: org.id, name: n } })).id;

  // ───────── Employees ─────────
  let codeNo = 1;
  const emps: { id: string; code: string; siteKey: string; shiftIdx: number; weeklyOff: number; joining: string; status: string; locationId: string; reliability: number; punctuality: number }[] = [];
  const usedNames = new Set<string>();
  for (const d of siteDefs) {
    const site = sites[d.key];
    const totalRequired = d.required.reduce((a, b) => a + b, 0);
    for (let i = 0; i < d.employees; i++) {
      // Distribute so each shift has its required strength plus relief staff covering weekly offs.
      const shiftIdx = i < totalRequired ? (i < d.required[0] ? 0 : i < d.required[0] + d.required[1] ? 1 : 2) : i % 3;
      let designation = weightedDesignation();
      let first = pick(d.names[0]);
      if (designation === 'Lady Security Guard') first = pick(FEMALE);
      let name = `${first} ${pick(d.names[1])}`;
      while (usedNames.has(name)) name = `${pick(d.names[0])} ${pick(d.names[1])}`;
      usedNames.add(name);
      if (i === 0) designation = 'Head Guard';
      const joining = DateTime.fromISO('2019-01-01').plus({ days: between(0, 2400) }).toISODate()!;
      const status = i === d.employees - 1 ? 'RESIGNED' : i === d.employees - 2 && d.key === 'NKT' ? 'SUSPENDED' : 'ACTIVE';
      const code = `EMP${String(codeNo++).padStart(4, '0')}`;
      const e = await prisma.employee.create({
        data: {
          organizationId: org.id,
          employeeCode: code,
          fullName: name,
          phone: phone(),
          address: `${pick(['Near Hanuman Temple', 'Opp. Gram Panchayat', 'Main Bazaar', 'Behind Bus Stand', 'Station Road'])}, ${d.district}, ${d.state}`,
          emergencyContact: `${pick(d.names[0])} (brother) ${phone()}`,
          designationId: desig[designation],
          departmentId: dept[DEPT[designation] ?? 'Security'],
          joiningDate: dateOnly(joining),
          employmentType: rand() < 0.7 ? 'CONTRACT' : 'PERMANENT',
          status: status as any,
          siteId: site.id,
          locationId: pick(site.locations),
          defaultShiftId: site.shifts[shiftIdx].id,
          weeklyOffDay: i % 7,
          siteHistory: { create: { siteId: site.id, startDate: dateOnly(joining), note: 'Initial deployment' } },
        },
      });
      emps.push({ id: e.id, code, siteKey: d.key, shiftIdx, weeklyOff: i % 7, joining, status, locationId: e.locationId!, reliability: 0.86 + rand() * 0.12, punctuality: 0.7 + rand() * 0.28 });
    }
  }
  // One transfer history example
  const transferred = emps.find((e) => e.siteKey === 'JSM')!;
  await prisma.employeeSiteAssignment.updateMany({ where: { employeeId: transferred.id }, data: { siteId: sites.NKT.id, endDate: dateOnly('2024-03-31'), note: 'Initial deployment (Kutch)' } });
  await prisma.employeeSiteAssignment.create({ data: { employeeId: transferred.id, siteId: sites.JSM.id, startDate: dateOnly('2024-04-01'), note: 'Transferred to Thar Wind Park' } });

  // ───────── Holidays & leave ─────────
  const holidays = [
    ['2026-01-26', 'Republic Day'],
    ['2026-03-04', 'Holi'],
    ['2026-08-15', 'Independence Day'],
    ['2026-10-02', 'Gandhi Jayanti'],
    ['2026-11-08', 'Diwali'],
    ['2026-12-25', 'Christmas'],
  ];
  await prisma.holiday.createMany({ data: holidays.map(([date, name]) => ({ organizationId: org.id, date: dateOnly(date), name })) });

  const leaveRanges: { employeeId: string; from: string; to: string; type: string; reason: string }[] = [];
  const active = emps.filter((e) => e.status === 'ACTIVE');
  for (let i = 0; i < 26; i++) {
    const e = pick(active);
    const start = addDays(today, -between(1, HISTORY_DAYS - 5));
    const len = between(1, 4);
    leaveRanges.push({ employeeId: e.id, from: start, to: addDays(start, len - 1), type: pick(['CASUAL', 'SICK', 'EARNED', 'CASUAL']), reason: pick(['Family function', 'Fever', 'Village visit', 'Medical check-up', 'Child’s school admission', 'Harvest at home']) });
  }
  // Current/upcoming leave so today's register shows auto-leave
  leaveRanges.push({ employeeId: active[3].id, from: addDays(today, -1), to: addDays(today, 2), type: 'SICK', reason: 'Viral fever — doctor’s note submitted' });
  leaveRanges.push({ employeeId: active[40].id, from: today, to: addDays(today, 4), type: 'EARNED', reason: 'Sister’s wedding' });
  const leaveClean: typeof leaveRanges = [];
  for (const l of leaveRanges) {
    if (leaveClean.some((x) => x.employeeId === l.employeeId && x.from <= l.to && x.to >= l.from)) continue;
    leaveClean.push(l);
  }
  await prisma.leaveRecord.createMany({
    data: leaveClean.map((l) => ({ organizationId: org.id, employeeId: l.employeeId, startDate: dateOnly(l.from), endDate: dateOnly(l.to), leaveType: l.type, reason: l.reason, recordedById: admin.id })),
  });
  const onLeave = (empId: string, day: string) => leaveClean.find((l) => l.employeeId === empId && l.from <= day && l.to >= day);

  // ───────── Roster & attendance history ─────────
  const settings = { overtimeEnabled: true, overtimeThresholdMins: 30, halfDayThresholdMins: 240 };
  const roster: Prisma.RosterEntryCreateManyInput[] = [];
  const records: Prisma.AttendanceRecordCreateManyInput[] = [];
  const registers: Prisma.AttendanceRegisterCreateManyInput[] = [];
  const approvals: { key: string; action: string; actorId: string; actorName: string; at: Date; note?: string }[] = [];
  const audits: Prisma.AuditLogCreateManyInput[] = [];
  const regKey = (site: string, shift: string, day: string) => `${site}|${shift}|${day}`;
  const regIds = new Map<string, string>();
  const cuidish = () => `seed${Math.floor(rand() * 1e12).toString(36)}${Math.floor(rand() * 1e12).toString(36)}`;

  for (let back = HISTORY_DAYS; back >= -7; back--) {
    const day = addDays(today, -back);
    const dow = weekday(day);
    for (const d of siteDefs) {
      const site = sites[d.key];
      const sups = supervisorsBySite[d.key];
      for (const [si, shift] of site.shifts.entries()) {
        const w = shiftWindow(day, shift, TZ);
        const started = now >= w.start.getTime();
        const ended = now >= w.end.getTime();
        const marker = sups.length > 1 && si === 2 ? sups[1] : sups[0];
        const staff = emps.filter((e) => e.siteKey === d.key && e.shiftIdx === si && e.joining <= day && (e.status === 'ACTIVE' || (e.status !== 'ACTIVE' && back > 20)) && e.weeklyOff !== dow);
        // Leave a gap on a couple of future/today slots so "understaffed" alerts appear.
        const rosterStaff = back <= 0 && d.key === 'MPL' && si === 2 ? staff.slice(0, Math.max(0, staff.length - 2)) : staff;
        for (const e of rosterStaff) roster.push({ organizationId: org.id, siteId: site.id, shiftId: shift.id, employeeId: e.id, workDate: dateOnly(day), locationId: e.locationId });
        if (!started || back < 0) continue;

        const regId = cuidish();
        const k = regKey(site.id, shift.id, day);
        regIds.set(k, regId);
        const regStatus = back >= 3 ? 'APPROVED' : back >= 1 ? (si === 2 && back === 1 ? 'OPEN' : 'SUBMITTED') : 'OPEN';
        registers.push({ id: regId, organizationId: org.id, siteId: site.id, shiftId: shift.id, workDate: dateOnly(day), status: regStatus as any, submittedById: regStatus !== 'OPEN' ? marker.id : null, submittedAt: regStatus !== 'OPEN' ? new Date(w.end.getTime() + between(10, 50) * 60_000) : null });
        if (regStatus !== 'OPEN') {
          approvals.push({ key: regId, action: 'SUBMITTED', actorId: marker.id, actorName: marker.fullName, at: new Date(w.end.getTime() + 30 * 60_000) });
          if (regStatus === 'APPROVED') approvals.push({ key: regId, action: 'APPROVED', actorId: admin.id, actorName: 'Vikram Solanki', at: new Date(w.end.getTime() + between(4, 20) * 3600_000) });
        }

        // How far along is today's shift? Mark a realistic share.
        const progress = ended ? 1 : Math.min(1, (now - w.start.getTime()) / (w.end.getTime() - w.start.getTime()));
        for (const [ei, e] of rosterStaff.entries()) {
          if (!ended && back === 0 && ei >= Math.ceil(rosterStaff.length * (progress > 0.05 ? 0.85 : 0.4))) continue; // not yet marked
          let status: AttendanceStatus = 'PRESENT';
          let checkIn: Date | null = null;
          let checkOut: Date | null = null;
          let remarks: string | null = null;
          let mode: EntryMode = 'LIVE';
          let manualReason: string | null = null;
          const leave = onLeave(e.id, day);
          const r = rand();
          if (leave) {
            status = 'LEAVE';
            remarks = `Approved ${leave.type.toLowerCase()} leave`;
          } else if (r > e.reliability + 0.06) {
            status = 'ABSENT';
            remarks = pick([null, 'Not reachable on phone', 'Informed late — bus breakdown', 'No intimation', 'Family emergency (informed)']);
          } else {
            const late = rand() > e.punctuality ? between(12, 55) : between(-15, 8);
            checkIn = new Date(w.start.getTime() + late * 60_000);
            if (checkIn.getTime() > now) continue; // not arrived yet
            if (ended || (back === 0 && now > w.end.getTime())) {
              const half = rand() < 0.015;
              const extra = rand() < 0.12 ? between(35, 150) : between(-8, 25);
              checkOut = half ? new Date(checkIn.getTime() + between(180, 230) * 60_000) : new Date(w.end.getTime() + extra * 60_000);
              if (half) remarks = 'Left early — unwell';
              if (extra > 60) remarks = pick(['Held back — relief guard late', 'Escort duty for crane movement', 'Stayed for substation shutdown work']);
              // A few historical incomplete check-outs
              if (rand() < 0.006 && back > 1) {
                checkOut = null;
                status = 'INCOMPLETE';
              }
            } else {
              status = 'ON_DUTY';
            }
            // Never record a check-out later than the moment the seed runs.
            if (checkOut && checkOut.getTime() > now) {
              checkOut = null;
              status = 'ON_DUTY';
            }
            if (late > 30 && rand() < 0.5) remarks = pick(['Late — two-wheeler puncture', 'Late — heavy rain on approach road', 'Late — bus delayed']);
            if (rand() < 0.04) {
              mode = 'MANUAL';
              manualReason = pick(['Recorded from paper register — phone battery dead', 'Entered after patrol round', 'Gate tablet not available']);
            } else if (rand() < 0.05 && d.key !== 'MPL') mode = 'OFFLINE';
          }
          const dv = derive({ status, checkInAt: checkIn, checkOutAt: checkOut, scheduledStart: w.start, scheduledEnd: w.end }, shift, settings, { autoStatusOnCheckout: !!checkOut });
          const id = cuidish();
          const markedAt = checkOut ?? checkIn ?? new Date(w.start.getTime() + 20 * 60_000);
          records.push({
            id,
            organizationId: org.id,
            siteId: site.id,
            shiftId: shift.id,
            employeeId: e.id,
            workDate: dateOnly(day),
            status: dv.status,
            scheduledStart: w.start,
            scheduledEnd: w.end,
            checkInAt: checkIn,
            checkOutAt: checkOut,
            workedMinutes: dv.workedMinutes,
            overtimeMinutes: dv.overtimeMinutes,
            lateMinutes: dv.lateMinutes,
            isLate: dv.isLate,
            remarks,
            entryMode: mode,
            manualReason,
            markedById: marker.id,
            registerId: regId,
            deviceRecordedAt: mode === 'OFFLINE' ? markedAt : null,
            syncedAt: mode === 'OFFLINE' ? new Date(Math.min(now, markedAt.getTime() + between(20, 300) * 60_000)) : null,
            offlineClientId: mode === 'OFFLINE' ? `seed-${id}` : null,
            createdAt: markedAt,
            updatedAt: markedAt,
          });
          if (back <= 14) {
            audits.push({
              organizationId: org.id,
              userId: marker.id,
              userName: marker.fullName,
              userRole: 'SUPERVISOR',
              action: checkOut ? 'attendance.check_out' : checkIn ? 'attendance.check_in' : 'attendance.create',
              entity: 'AttendanceRecord',
              entityId: id,
              newValues: { status: dv.status, employeeCode: e.code, workDate: day, shift: shift.code, site: d.key, mode },
              reason: manualReason,
              createdAt: markedAt,
            });
          }
        }
      }
    }
  }

  const chunk = async <T,>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
  };
  await chunk(roster, 2000, (p) => prisma.rosterEntry.createMany({ data: p, skipDuplicates: true }));
  await chunk(registers, 2000, (p) => prisma.attendanceRegister.createMany({ data: p }));
  await chunk(approvals, 2000, (p) =>
    prisma.attendanceApproval.createMany({ data: p.map((a) => ({ registerId: a.key, action: a.action, actorId: a.actorId, actorName: a.actorName, note: a.note ?? null, createdAt: a.at })) }),
  );
  await chunk(records, 2000, (p) => prisma.attendanceRecord.createMany({ data: p }));
  await chunk(audits, 2000, (p) => prisma.auditLog.createMany({ data: p }));
  console.log(`  ${roster.length} roster entries, ${records.length} attendance records, ${registers.length} registers`);

  // ───────── Corrections (one approved, two pending) ─────────
  const recent = await prisma.attendanceRecord.findMany({
    where: { organizationId: org.id, workDate: { gte: dateOnly(addDays(today, -6)), lte: dateOnly(addDays(today, -2)) }, status: 'PRESENT', checkInAt: { not: null } },
    take: 3,
    include: { employee: true },
  });
  if (recent.length === 3) {
    const [a, b, c] = recent;
    const newIn = new Date(a.scheduledStart.getTime() - 5 * 60_000);
    const dv = derive({ status: a.status, checkInAt: newIn, checkOutAt: a.checkOutAt, scheduledStart: a.scheduledStart, scheduledEnd: a.scheduledEnd }, (await prisma.shift.findUniqueOrThrow({ where: { id: a.shiftId } })), settings);
    await prisma.attendanceCorrection.create({
      data: {
        organizationId: org.id,
        attendanceId: a.id,
        requestedById: supNKT.id,
        reason: 'Check-in typed from the wrong row of the paper register; gate CCTV confirms 05:55 arrival.',
        previousValues: { status: a.status, checkInAt: a.checkInAt, checkOutAt: a.checkOutAt },
        proposedValues: { checkInAt: newIn.toISOString() },
        status: 'APPROVED',
        reviewedById: admin.id,
        reviewNote: 'Verified against CCTV log.',
        reviewedAt: new Date(now - 26 * 3600_000),
        createdAt: new Date(now - 30 * 3600_000),
      },
    });
    await prisma.attendanceRecord.update({ where: { id: a.id }, data: { checkInAt: newIn, lateMinutes: dv.lateMinutes, isLate: dv.isLate, workedMinutes: dv.workedMinutes, overtimeMinutes: dv.overtimeMinutes, entryMode: 'CORRECTION', version: 2 } });
    await prisma.auditLog.create({
      data: { organizationId: org.id, userId: admin.id, userName: 'Vikram Solanki', userRole: 'COMPANY_ADMIN', action: 'attendance.correction.apply', entity: 'AttendanceRecord', entityId: a.id, previousValues: { checkInAt: a.checkInAt }, newValues: { checkInAt: newIn }, reason: 'Check-in typed from the wrong row of the paper register', createdAt: new Date(now - 26 * 3600_000) },
    });
    await prisma.attendanceCorrection.create({
      data: {
        organizationId: org.id,
        attendanceId: b.id,
        requestedById: b.siteId === sites.NKT.id ? supNKT.id : b.siteId === sites.MPL.id ? supMPL.id : supJSM.id,
        reason: 'Guard stayed back for turbine crane escort; checkout was recorded at the gate before the escort.',
        previousValues: { status: b.status, checkInAt: b.checkInAt, checkOutAt: b.checkOutAt },
        proposedValues: { checkOutAt: new Date((b.checkOutAt ?? b.scheduledEnd).getTime() + 95 * 60_000).toISOString(), remarks: 'Crane escort — OT approved by site in-charge' },
        createdAt: new Date(now - 5 * 3600_000),
      },
    });
    await prisma.attendanceCorrection.create({
      data: {
        organizationId: org.id,
        attendanceId: c.id,
        requestedById: c.siteId === sites.NKT.id ? supNKT.id : c.siteId === sites.MPL.id ? supMPL.id : supJSM.id,
        reason: 'Employee was on approved half day; marked present by mistake.',
        previousValues: { status: c.status, checkInAt: c.checkInAt, checkOutAt: c.checkOutAt },
        proposedValues: { status: 'HALF_DAY' },
        createdAt: new Date(now - 2 * 3600_000),
      },
    });
  }

  // ───────── Shift handovers ─────────
  for (let back = 6; back >= 0; back--) {
    const day = addDays(today, -back);
    for (const key of ['NKT', 'JSM'] as const) {
      const site = sites[key];
      const shift = site.shifts[back % 2];
      const w = shiftWindow(day, shift, TZ);
      if (w.end.getTime() > now) continue;
      const roster2 = await prisma.rosterEntry.findMany({ where: { shiftId: shift.id, workDate: dateOnly(day) }, include: { employee: true } });
      const recs = await prisma.attendanceRecord.findMany({ where: { shiftId: shift.id, workDate: dateOnly(day) } });
      const present = roster2.filter((r) => recs.find((x) => x.employeeId === r.employeeId && ['PRESENT', 'HALF_DAY', 'ON_DUTY', 'INCOMPLETE'].includes(x.status)));
      const missing = roster2.filter((r) => !present.includes(r));
      const out = supervisorsBySite[key][0];
      const incoming = key === 'NKT' ? supNKT2 : null;
      await prisma.shiftHandover.create({
        data: {
          organizationId: org.id,
          siteId: site.id,
          shiftId: shift.id,
          workDate: dateOnly(day),
          outgoingSupervisorId: out.id,
          outgoingName: out.fullName,
          incomingSupervisorId: incoming?.id ?? null,
          incomingName: incoming?.fullName ?? null,
          handoverAt: w.end,
          presentCount: present.length,
          presentEmployees: present.map((p) => ({ code: p.employee.employeeCode, name: p.employee.fullName, status: 'PRESENT' })),
          missingEmployees: missing.map((p) => ({ code: p.employee.employeeCode, name: p.employee.fullName, status: recs.find((x) => x.employeeId === p.employeeId)?.status ?? 'PENDING' })),
          remarks: pick(['All turbine cluster patrols completed. Gate log reconciled.', 'Two OEM vans inside till 19:30 for gearbox inspection.', 'Perimeter fence breach near T17 reported to maintenance; temporary barricade placed.', 'Normal shift. No incidents.']),
          pendingIssues: pick([null, 'CCTV camera 4 (switchyard) offline since 11:00.', 'Fire extinguisher refill due at control room.', null]),
          status: back === 0 ? 'PENDING' : 'CONFIRMED',
          confirmedAt: back === 0 ? null : new Date(w.end.getTime() + 15 * 60_000),
        },
      });
    }
  }

  // ───────── Gate register ─────────
  const visitorTemplates = [
    { type: 'OEM_ENGINEER', company: 'Turbine OEM Service Team', purpose: 'Scheduled WTG maintenance – gearbox oil change', meet: 'Site In-charge' },
    { type: 'VENDOR', company: 'Diesel Supply Vendor', purpose: 'DG set diesel delivery', meet: 'Store Keeper' },
    { type: 'CONTRACTOR', company: 'Crane Rental Contractor', purpose: 'Blade replacement crane mobilisation', meet: 'Project Engineer' },
    { type: 'OFFICIAL', company: 'State Transmission Utility', purpose: 'Substation metering inspection', meet: 'Substation Engineer' },
    { type: 'DELIVERY', company: 'Courier', purpose: 'Spare parts consignment', meet: 'Store Keeper' },
    { type: 'VISITOR', company: 'Local Gram Panchayat', purpose: 'Right-of-way discussion', meet: 'Site In-charge' },
    { type: 'CONTRACTOR', company: 'Vegetation Clearing Crew', purpose: 'Bush clearing along internal roads', meet: 'Civil Supervisor' },
  ];
  const statePrefix: Record<string, string> = { NKT: 'GJ-12', MPL: 'TN-74', JSM: 'RJ-15' };
  const gate: Prisma.GateEntryCreateManyInput[] = [];
  for (let back = 30; back >= 0; back--) {
    const day = addDays(today, -back);
    for (const d of siteDefs) {
      const n = between(3, 9);
      for (let i = 0; i < n; i++) {
        const t = pick(visitorTemplates);
        const inAt = DateTime.fromISO(day, { zone: TZ }).set({ hour: between(7, 17), minute: between(0, 59) }).toJSDate();
        if (inAt.getTime() > now) continue;
        const outAt = new Date(inAt.getTime() + between(25, 360) * 60_000);
        const sup = supervisorsBySite[d.key][0];
        const vehicle = rand() < 0.7 ? `${statePrefix[d.key]}-${pick(['AB', 'BT', 'CK', 'DX', 'AT', 'Z'])}-${between(1000, 9999)}` : null;
        gate.push({
          organizationId: org.id,
          siteId: sites[d.key].id,
          visitorName: `${pick(d.names[0])} ${pick(d.names[1])}`,
          company: t.company,
          visitorType: t.type,
          mobile: phone(),
          purpose: t.purpose,
          vehicleNumber: vehicle,
          personToMeet: t.meet,
          entryAt: inAt,
          exitAt: outAt.getTime() < now ? outAt : null,
          recordedById: sup.id,
          recordedByName: sup.fullName,
          remarks: vehicle && rand() < 0.2 ? 'Vehicle checked — tools listed on gate pass' : null,
        });
      }
    }
  }
  await prisma.gateEntry.createMany({ data: gate });

  // ───────── Notifications ─────────
  await prisma.notification.createMany({
    data: [
      { organizationId: org.id, userId: admin.id, type: 'correction.requested', title: 'Attendance correction requested', body: 'Two correction requests are awaiting your review.', link: '/attendance/corrections', severity: 'WARNING' },
      { organizationId: org.id, userId: admin.id, type: 'register.pending_approval', title: 'Registers awaiting approval', body: 'Yesterday’s registers from Nakhatrana, Muppandal and Jaisalmer are submitted.', link: '/attendance?tab=approvals', severity: 'INFO' },
      { organizationId: org.id, userId: supNKT.id, type: 'roster.changed', title: 'Roster generated for next week', body: 'The roster for Nakhatrana Wind Farm has been generated from default shifts.', link: '/shifts?tab=roster', severity: 'INFO', readAt: new Date() },
      { organizationId: org.id, userId: supNKT2.id, type: 'handover.pending', title: 'Shift handover awaiting your confirmation', body: 'Harish Chavda handed over First Shift at Nakhatrana Wind Farm.', link: '/shifts?tab=handover', severity: 'WARNING' },
    ],
  });

  console.log('Done.');
  console.log(`\nDemo sign-in (password for all: ${PASSWORD})`);
  console.log('  superadmin@windguard.local   Super Admin');
  console.log('  admin@windguard.local        Company Admin');
  console.log('  supervisor@windguard.local   Supervisor – Nakhatrana');
  console.log('  supervisor.mpl@windguard.local / supervisor.jsm@windguard.local');
  console.log('  auditor@windguard.local      Viewer / Auditor');
}

/** Wipes the database and loads the demo data set (used by the CLI seed and the in-browser demo). */
export async function seedDatabase(client: PrismaClient) {
  prisma = client;
  await main();
}

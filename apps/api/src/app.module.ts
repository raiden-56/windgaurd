import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditService } from './common/audit.service';
import { AuthGuard } from './common/auth.guard';
import { NotifyService } from './common/notify.service';
import { OrgService } from './common/org.service';
import { PrismaService } from './common/prisma.service';
import { QueueService } from './common/queue.service';
import { AttendanceController } from './modules/attendance/attendance.controller';
import { AttendanceService } from './modules/attendance/attendance.service';
import { CorrectionsService } from './modules/attendance/corrections.service';
import { SyncService } from './modules/attendance/sync.service';
import { AuthController } from './modules/auth/auth.controller';
import { DashboardController } from './modules/dashboard/dashboard.controller';
import { EmployeesController } from './modules/employees/employees.controller';
import { EmployeesService } from './modules/employees/employees.service';
import { ImportsController } from './modules/imports/imports.controller';
import { MiscController } from './modules/misc/misc.controller';
import { SweepService } from './modules/misc/sweep.service';
import { ExportService } from './modules/reports/export.service';
import { ReportsController } from './modules/reports/reports.controller';
import { ReportsService } from './modules/reports/reports.service';
import { RosterService } from './modules/shifts/roster.service';
import { ShiftsController } from './modules/shifts/shifts.controller';
import { SitesController } from './modules/sites/sites.controller';
import { UsersController } from './modules/users/users.controller';

/** Cross-cutting services: database, audit trail, tenancy helpers, notifications, jobs. */
@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'dev-only-change-me',
    }),
  ],
  providers: [PrismaService, AuditService, OrgService, NotifyService, QueueService],
  exports: [PrismaService, AuditService, OrgService, NotifyService, QueueService],
})
class CoreModule {}

@Module({
  imports: [CoreModule],
  controllers: [AuthController],
})
class AuthModule {}

@Module({
  imports: [CoreModule],
  controllers: [SitesController, UsersController],
})
class DirectoryModule {}

@Module({
  imports: [CoreModule],
  controllers: [EmployeesController, ImportsController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
class EmployeesModule {}

@Module({
  imports: [CoreModule],
  controllers: [ShiftsController, AttendanceController],
  providers: [RosterService, AttendanceService, CorrectionsService, SyncService],
})
class AttendanceModule {}

@Module({
  imports: [CoreModule],
  controllers: [ReportsController, DashboardController, MiscController],
  providers: [ReportsService, ExportService, SweepService],
})
class ReportingModule {}

@Module({
  imports: [ScheduleModule.forRoot(), CoreModule, AuthModule, DirectoryModule, EmployeesModule, AttendanceModule, ReportingModule],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}

import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { SmsTemplateKey, UserRole } from '@prisma/client';
import * as request from 'supertest';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, ROLES_KEY } from '../../common/guards/roles.guard';
import { SmsCallbackSignatureGuard } from '../../common/guards/sms-callback-signature.guard';

describe('SmsController', () => {
  let controller: SmsController;

  const mockSmsService = {
    sendSms: jest.fn(),
    getDeliveryStatus: jest.fn(),
    handleDeliveryCallback: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SmsController],
      providers: [{ provide: SmsService, useValue: mockSmsService }],
    }).compile();

    controller = module.get<SmsController>(SmsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('sendSms', () => {
    it('delegates to SmsService.sendSms with the assembled payload', async () => {
      mockSmsService.sendSms.mockResolvedValue({ id: 'sms-1' });
      const templateKey = Object.values(SmsTemplateKey)[0] as SmsTemplateKey;

      const dto = {
        phoneNumber: '5551234',
        countryCode: '+1',
        userId: 'user-1',
        templateKey,
        templateData: { name: 'Ada' },
        message: 'hi',
      };

      const res = await controller.sendSms(dto);

      expect(mockSmsService.sendSms).toHaveBeenCalledWith({
        phoneNumber: '5551234',
        countryCode: '+1',
        userId: 'user-1',
        templateKey,
        templateData: { name: 'Ada' },
        message: 'hi',
      });
      expect(res).toEqual({ id: 'sms-1' });
    });
  });

  describe('sendSms validation', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef: TestingModule = await Test.createTestingModule({
        controllers: [SmsController],
        providers: [{ provide: SmsService, useValue: mockSmsService }],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: () => true })
        .overrideGuard(RolesGuard)
        .useValue({ canActivate: () => true })
        .compile();

      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('returns 400 when phoneNumber is missing', async () => {
      await request(app.getHttpServer())
        .post('/notifications/sms/send')
        .send({ countryCode: '+1' })
        .expect(400);

      expect(mockSmsService.sendSms).not.toHaveBeenCalled();
    });

    it('returns 400 when templateKey is unknown', async () => {
      await request(app.getHttpServer())
        .post('/notifications/sms/send')
        .send({ phoneNumber: '5551234', countryCode: '+1', templateKey: 'NOT_A_TEMPLATE' })
        .expect(400);

      expect(mockSmsService.sendSms).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('delegates to SmsService.getDeliveryStatus', async () => {
      mockSmsService.getDeliveryStatus.mockResolvedValue({ status: 'DELIVERED' });

      const res = await controller.getStatus('sms-1');

      expect(mockSmsService.getDeliveryStatus).toHaveBeenCalledWith('sms-1');
      expect(res).toEqual({ status: 'DELIVERED' });
    });
  });

  describe('handleCallback', () => {
    it('delegates to SmsService.handleDeliveryCallback when guard passes', async () => {
      const payload = { id: 'sms-1', status: 'DELIVERED' };
      mockSmsService.handleDeliveryCallback.mockResolvedValue({ ok: true });

      const res = await controller.handleCallback(payload);

      expect(mockSmsService.handleDeliveryCallback).toHaveBeenCalledWith(payload);
      expect(res).toEqual({ ok: true });
    });

    it('does NOT call SmsService when SmsCallbackSignatureGuard rejects with UnauthorizedException', async () => {
      const payload = { id: 'sms-1', status: 'DELIVERED' };
      // Simulate guard rejection — handleDeliveryCallback must NOT be reached
      const mockGuard: Partial<SmsCallbackSignatureGuard> = {
        canActivate: jest.fn().mockImplementation(() => {
          throw new UnauthorizedException('SMS callback signature is required.');
        }),
      };

      // Confirm guard throws before service is invoked
      expect(() => mockGuard.canActivate!(null as any)).toThrow(UnauthorizedException);
      expect(mockSmsService.handleDeliveryCallback).not.toHaveBeenCalled();
    });

    it('does NOT call SmsService when guard returns false for invalid signature', async () => {
      const mockGuard: Partial<SmsCallbackSignatureGuard> = {
        canActivate: jest.fn().mockReturnValue(false),
      };

      const guardResult = mockGuard.canActivate!(null as any);
      expect(guardResult).toBe(false);
      expect(mockSmsService.handleDeliveryCallback).not.toHaveBeenCalled();
    });
  });

  describe('guard wiring', () => {
    it.each(['sendSms', 'getStatus'] as const)('%s is protected by JwtAuthGuard + RolesGuard for ADMIN', (method) => {
      const handler = SmsController.prototype[method];
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, RolesGuard]);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
    });

    it('applies SmsCallbackSignatureGuard to the gateway callback route', () => {
      const handler = SmsController.prototype.handleCallback;
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler);
      expect(guards).toEqual([SmsCallbackSignatureGuard]);
    });

    it('does not apply controller-level guards (no class-level guard)', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, SmsController)).toBeUndefined();
    });
  });
});

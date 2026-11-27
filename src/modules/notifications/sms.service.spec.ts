import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { SmsStatus, SmsTemplateKey } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SmsService } from './sms.service';

const mockGatewaySend = jest.fn();

jest.mock('africastalking', () =>
  jest.fn(() => ({
    SMS: {
      send: (...args: unknown[]) => mockGatewaySend(...args),
    },
  })),
);

describe('SmsService', () => {
  let service: SmsService;

  const mockPrisma = {
    smsMessage: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  };

  const configValues: Record<string, unknown> = {
    AFRICASTALKING_API_KEY: 'test-key',
    AFRICASTALKING_USERNAME: 'sandbox',
    AFRICASTALKING_SENDER_ID: 'SOROBANLARD',
  };

  const configGet = jest.fn((key: string, defaultValue?: unknown) =>
    configValues[key] !== undefined ? configValues[key] : defaultValue,
  );

  const gatewayResponse = (status: string, messageId?: string) => ({
    SMSMessageData: {
      Recipients: [{ status, messageId, number: '+2348012345678' }],
    },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    service = module.get<SmsService>(SmsService);

    jest.clearAllMocks();
    configGet.mockImplementation((key: string, defaultValue?: unknown) =>
      configValues[key] !== undefined ? configValues[key] : defaultValue,
    );

    mockPrisma.smsMessage.create.mockResolvedValue({ id: 'sms-1' });
    mockPrisma.smsMessage.update.mockResolvedValue({ id: 'sms-1', status: SmsStatus.SENT });
    mockPrisma.smsMessage.findUnique.mockResolvedValue(null);
    mockGatewaySend.mockResolvedValue(gatewayResponse('Success', 'provider-1'));
  });

  describe('validatePhoneNumber()', () => {
    it('rejects an unsupported country code', () => {
      expect(() => service.validatePhoneNumber('+14155552671', 'US')).toThrow(
        BadRequestException,
      );
      expect(() => service.validatePhoneNumber('+14155552671', 'US')).toThrow(
        'Unsupported country code: US',
      );
    });

    it('rejects a number that does not match the country format', () => {
      expect(() => service.validatePhoneNumber('12345', 'NG')).toThrow(
        BadRequestException,
      );
      expect(() => service.validatePhoneNumber('12345', 'NG')).toThrow(
        'Invalid phone number format for country NG',
      );
    });

    it('rejects an empty phone number', () => {
      expect(() => service.validatePhoneNumber('   ', 'NG')).toThrow(BadRequestException);
    });

    it('normalises a local number into E.164 form', () => {
      expect(service.validatePhoneNumber('08012345678', 'NG')).toBe('+2348012345678');
    });

    it('keeps an already international number untouched', () => {
      expect(service.validatePhoneNumber('+2348012345678', 'NG')).toBe('+2348012345678');
    });

    it('trims surrounding whitespace before validating', () => {
      expect(service.validatePhoneNumber('  08012345678  ', 'NG')).toBe('+2348012345678');
    });

    it('accepts a lower-case country code', () => {
      expect(service.validatePhoneNumber('08012345678', 'ng')).toBe('+2348012345678');
    });

    it('strips spaces from an international number', () => {
      expect(service.validatePhoneNumber('+234 801 234 5678', 'NG')).toBe('+2348012345678');
    });

    it('strips dashes from a local number', () => {
      expect(service.validatePhoneNumber('0801-234-5678', 'NG')).toBe('+2348012345678');
    });

    it('strips parentheses from a number', () => {
      expect(service.validatePhoneNumber('(0801) 234 5678', 'NG')).toBe('+2348012345678');
    });

    it('supports the other supported countries', () => {
      expect(service.validatePhoneNumber('0712345678', 'KE')).toBe('+254712345678');
      expect(service.validatePhoneNumber('0772345678', 'UG')).toBe('+256772345678');
      expect(service.validatePhoneNumber('0241234567', 'GH')).toBe('+233241234567');
      expect(service.validatePhoneNumber('0821234567', 'ZA')).toBe('+27821234567');
      expect(service.validatePhoneNumber('0754123456', 'TZ')).toBe('+255754123456');
    });

    describe('per-country accepted/rejected matrix', () => {
      const cases: Array<{
        country: string;
        input: string;
        expected: string | null;
      }> = [
        { country: 'NG', input: '+234 801 234 5678', expected: '+2348012345678' },
        { country: 'NG', input: '0801-234-5678', expected: '+2348012345678' },
        { country: 'NG', input: '12345', expected: null },
        { country: 'KE', input: '+254 712 345 678', expected: '+254712345678' },
        { country: 'KE', input: '0712-345-678', expected: '+254712345678' },
        { country: 'KE', input: '0000000000', expected: null },
        { country: 'UG', input: '+256 772 345 678', expected: '+256772345678' },
        { country: 'UG', input: '0772-345-678', expected: '+256772345678' },
        { country: 'UG', input: '12345', expected: null },
        { country: 'GH', input: '+233 24 123 4567', expected: '+233241234567' },
        { country: 'GH', input: '024-123-4567', expected: '+233241234567' },
        { country: 'GH', input: '9999999999', expected: null },
        { country: 'ZA', input: '+27 82 123 4567', expected: '+27821234567' },
        { country: 'ZA', input: '082-123-4567', expected: '+27821234567' },
        { country: 'ZA', input: '12345', expected: null },
        { country: 'TZ', input: '+255 754 123 456', expected: '+255754123456' },
        { country: 'TZ', input: '0754-123-456', expected: '+255754123456' },
        { country: 'TZ', input: '0000000000', expected: null },
      ];

      it.each(cases)('$country $input -> $expected', ({ country, input, expected }) => {
        if (expected === null) {
          expect(() => service.validatePhoneNumber(input, country)).toThrow(
            BadRequestException,
          );
        } else {
          expect(service.validatePhoneNumber(input, country)).toBe(expected);
        }
      });
    });
  });

  describe('renderTemplate()', () => {
    it('renders a template with the supplied data', () => {
      const rendered = service.renderTemplate(SmsTemplateKey.ACCOUNT_VERIFICATION, {
        name: 'Ada',
        code: '123456',
        minutes: 10,
      });

      expect(rendered).toBe(
        'Hi Ada, your SorobanLard verification code is 123456. It expires in 10 minutes.',
      );
      expect(rendered).not.toContain('{{');
    });

    it('throws when a placeholder value is missing', () => {
      expect(() =>
        service.renderTemplate(SmsTemplateKey.ACCOUNT_VERIFICATION, { name: 'Ada' }),
      ).toThrow(BadRequestException);
      expect(() =>
        service.renderTemplate(SmsTemplateKey.ACCOUNT_VERIFICATION, { name: 'Ada' }),
      ).toThrow('Missing SMS template values: code, minutes');
    });

    it('renders the generic alert template from the message data', () => {
      expect(
        service.renderTemplate(SmsTemplateKey.GENERIC_ALERT, { message: 'Server downtime' }),
      ).toBe('Server downtime');
    });

    it('rejects an unknown template key', () => {
      expect(() =>
        service.renderTemplate('NOT_A_TEMPLATE' as SmsTemplateKey),
      ).toThrow(BadRequestException);
    });
  });

  describe('sendSms()', () => {
    it('persists a pending record and marks it sent on success', async () => {
      const result = await service.sendSms({
        phoneNumber: '08012345678',
        countryCode: 'ng',
        userId: 'user-1',
        templateKey: SmsTemplateKey.ACCOUNT_VERIFICATION,
        templateData: { name: 'Ada', code: '123456', minutes: 10 },
      });

      expect(mockPrisma.smsMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          phoneNumber: '+2348012345678',
          countryCode: 'NG',
          templateKey: SmsTemplateKey.ACCOUNT_VERIFICATION,
          status: SmsStatus.PENDING,
        }),
      });

      expect(mockGatewaySend).toHaveBeenCalledWith({
        to: ['+2348012345678'],
        message: 'Hi Ada, your SorobanLard verification code is 123456. It expires in 10 minutes.',
        from: 'SOROBANLARD',
      });

      expect(mockPrisma.smsMessage.update).toHaveBeenCalledWith({
        where: { id: 'sms-1' },
        data: expect.objectContaining({
          status: SmsStatus.SENT,
          providerMessageId: 'provider-1',
          failureReason: null,
        }),
      });
      expect(result).toEqual({ id: 'sms-1', status: SmsStatus.SENT });
    });

    it('sends a raw message when no template key is provided', async () => {
      await service.sendSms({
        phoneNumber: '+2348012345678',
        countryCode: 'NG',
        message: 'Your enrollment is confirmed',
      });

      expect(mockGatewaySend).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Your enrollment is confirmed' }),
      );
      expect(mockPrisma.smsMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ templateKey: undefined, message: 'Your enrollment is confirmed' }),
      });
    });

    it('rejects the send when neither a template nor a message is provided', async () => {
      await expect(
        service.sendSms({ phoneNumber: '08012345678', countryCode: 'NG' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.smsMessage.create).not.toHaveBeenCalled();
      expect(mockGatewaySend).not.toHaveBeenCalled();
    });

    it('does not persist anything when the phone number is invalid', async () => {
      await expect(
        service.sendSms({ phoneNumber: '12345', countryCode: 'NG', message: 'hi' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.smsMessage.create).not.toHaveBeenCalled();
    });

    it('marks the message failed when the gateway reports a non-success status', async () => {
      mockGatewaySend.mockResolvedValueOnce(gatewayResponse('Rejected', undefined));

      await service.sendSms({
        phoneNumber: '08012345678',
        countryCode: 'NG',
        message: 'Your enrollment is confirmed',
      });

      expect(mockPrisma.smsMessage.update).toHaveBeenCalledWith({
        where: { id: 'sms-1' },
        data: expect.objectContaining({
          status: SmsStatus.FAILED,
          failureReason: expect.stringContaining('Rejected'),
        }),
      });
    });

    it('marks the message failed and rethrows when the gateway throws', async () => {
      const gatewayError = new Error('gateway unavailable');
      mockGatewaySend.mockRejectedValueOnce(gatewayError);

      await expect(
        service.sendSms({
          phoneNumber: '08012345678',
          countryCode: 'NG',
          message: 'Your enrollment is confirmed',
        }),
      ).rejects.toThrow('gateway unavailable');

      expect(mockPrisma.smsMessage.update).toHaveBeenCalledWith({
        where: { id: 'sms-1' },
        data: expect.objectContaining({
          status: SmsStatus.FAILED,
          failureReason: expect.any(String),
          sentAt: null,
        }),
      });
    });
  });
});

      expect(mockPrisma.smsMessage.update).toHaveBeenCalledWith({
        where: { id: 'sms-1' },
        data: expect.objectContaining({
          status: SmsStatus.FAILED,
          failureReason: 'network down',
          sentAt: null,
        }),
      });
    });
  });
});

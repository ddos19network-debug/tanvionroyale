import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { tryNormalizePhone } from '../utils/phone';

/**
 * `@IsPhoneNumber()` — accepts every input shape `tryNormalizePhone` supports
 * and reports the SAME actionable message the normalizer produces.
 *
 * This replaces the old `@Matches(/^\+[1-9]\d{7,14}$/)` guard, which rejected
 * `01712345678` outright (the production 400). Validation now only rejects
 * input the normalizer cannot turn into a canonical E.164 number, and the
 * message is user-facing copy — never a class-validator stack.
 *
 * The DTO deliberately keeps the RAW string: normalization to the canonical
 * value happens in the service through `normalizePhone()`, so the value that is
 * stored, looked up, OTPed and verified is the same object.
 */
export function IsPhoneNumber(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isPhoneNumber',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown): boolean => tryNormalizePhone(value).ok,
        defaultMessage: (args: ValidationArguments): string => {
          const result = tryNormalizePhone(args.value);
          return result.ok ? 'phone must be a valid mobile number' : result.message;
        },
      },
    });
  };
}

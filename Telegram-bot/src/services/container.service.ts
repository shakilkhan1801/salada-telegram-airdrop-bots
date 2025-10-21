import { 
  IContainer, 
  IBindingToSyntax, 
  IBindingInSyntax, 
  IBindingWhenSyntax, 
  ServiceIdentifier 
} from '../interfaces/container.interface';

interface Binding {
  serviceIdentifier: ServiceIdentifier;
  type: 'constructor' | 'constant' | 'factory' | 'function';
  target: any;
  scope: 'singleton' | 'transient';
  instance?: any;
}

class BindingSyntax<T> implements IBindingToSyntax<T>, IBindingInSyntax<T>, IBindingWhenSyntax<T> {
  private binding: Binding;

  constructor(binding: Binding) {
    this.binding = binding;
  }

  to(constructor: { new (...args: any[]): T }): IBindingInSyntax<T> {
    this.binding.type = 'constructor';
    this.binding.target = constructor;
    return this;
  }

  toConstantValue(value: T): IBindingWhenSyntax<T> {
    this.binding.type = 'constant';
    this.binding.target = value;
    this.binding.instance = value;
    return this;
  }

  toFactory(factory: () => T): IBindingWhenSyntax<T> {
    this.binding.type = 'factory';
    this.binding.target = factory;
    return this;
  }

  toFunction(func: T): IBindingWhenSyntax<T> {
    this.binding.type = 'function';
    this.binding.target = func;
    return this;
  }

  inSingletonScope(): IBindingWhenSyntax<T> {
    this.binding.scope = 'singleton';
    return this;
  }

  inTransientScope(): IBindingWhenSyntax<T> {
    this.binding.scope = 'transient';
    return this;
  }

  when(_constraint: (request: any) => boolean): void {
    // Simple implementation - not handling constraints for now
  }

  whenTargetNamed(_name: string | symbol): void {
    // Simple implementation - not handling named targets for now
  }

  whenTargetTagged(_tag: string | symbol, _value: any): void {
    // Simple implementation - not handling tagged targets for now
  }
}

export class Container implements IContainer {
  private static instance: Container;
  private bindings = new Map<ServiceIdentifier, Binding>();

  private constructor() {}

  static getInstance(): Container {
    if (!Container.instance) {
      Container.instance = new Container();
    }
    return Container.instance;
  }

  bind<T>(serviceIdentifier: ServiceIdentifier<T>): IBindingToSyntax<T> {
    const binding: Binding = {
      serviceIdentifier,
      type: 'constructor',
      target: null,
      scope: 'singleton'
    };

    this.bindings.set(serviceIdentifier, binding);
    return new BindingSyntax<T>(binding);
  }

  get<T>(serviceIdentifier: ServiceIdentifier<T>): T {
    const binding = this.bindings.get(serviceIdentifier);
    if (!binding) {
      throw new Error(`No binding found for service identifier: ${String(serviceIdentifier)}`);
    }

    // Return cached singleton instance if available
    if (binding.scope === 'singleton' && binding.instance) {
      return binding.instance;
    }

    let instance: T;

    switch (binding.type) {
      case 'constant':
        instance = binding.target;
        break;
      case 'factory':
        instance = binding.target();
        break;
      case 'function':
        instance = binding.target;
        break;
      case 'constructor':
        instance = this.createInstance(binding.target);
        break;
      default:
        throw new Error(`Unsupported binding type: ${binding.type}`);
    }

    // Cache singleton instances
    if (binding.scope === 'singleton') {
      binding.instance = instance;
    }

    return instance;
  }

  isBound<T>(serviceIdentifier: ServiceIdentifier<T>): boolean {
    return this.bindings.has(serviceIdentifier);
  }

  unbind<T>(serviceIdentifier: ServiceIdentifier<T>): void {
    this.bindings.delete(serviceIdentifier);
  }

  rebind<T>(serviceIdentifier: ServiceIdentifier<T>): IBindingToSyntax<T> {
    this.unbind(serviceIdentifier);
    return this.bind(serviceIdentifier);
  }

  private createInstance<T>(constructor: { new (...args: any[]): T }): T {
    // Simple implementation - no automatic dependency injection for now
    // Services will need to get their dependencies through the container
    return new constructor();
  }

  /**
   * Clear all bindings (useful for testing)
   */
  clear(): void {
    this.bindings.clear();
  }
}
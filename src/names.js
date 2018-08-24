let Names = {};

Names.Providers = {};
Names.noProviderError = 'Name system provider not set; e.g EmbarkJS.Names.setProvider("ens")';

Names.registerProvider = function (providerName, obj) {
  Names.Providers[providerName] = obj;
};

Names.setProvider = function (providerName, options) {
  let provider = this.Providers[providerName];

  if (!provider) {
    throw new Error('Unknown name system provider');
  }

  this.currentNameSystemsName = providerName;
  this.currentNameSystems = provider;

  return provider.setProvider(options);
};

// resolve resolves a name into an identifier of some kind
Names.resolve = function (name, callback) {
  if (!this.currentNameSystems) {
    throw new Error(this.noProviderError);
  }
  return this.currentNameSystems.resolve(name, callback);
};

// the reverse of resolve, resolves using an identifier to get to a name
Names.lookup = function (identifier, callback) {
  if (!this.currentNameSystems) {
    throw new Error(this.noProviderError);
  }
  return this.currentNameSystems.lookup(identifier, callback);
};

Names.isAvailable = function () {
    return this.currentNameSystems.isAvailable();
};

Names.registerSubDomain = function(name, address, callback) {
  if (!this.currentNameSystems) {
    throw new Error(this.noProviderError);
  }
  return this.currentNameSystems.registerSubDomain(name, address, callback);
};

export default Names;

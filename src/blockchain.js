/*global ethereum*/
import {reduce} from './async';

let Blockchain = {};
let contracts = [];

Blockchain.Providers = {};

Blockchain.registerProvider = function(providerName, obj) {
  this.Providers[providerName] = obj;
};

Blockchain.setProvider = function(providerName, options) {
  let provider = this.Providers[providerName];

  if (!provider) {
    throw new Error('Unknown blockchain provider. ' +
      'Make sure to register it first using EmbarkJS.Blockchain.registerProvider(providerName, providerObject');
  }

  this.currentProviderName = providerName;
  this.blockchainConnector = provider;

  provider.init(options);
};

Blockchain.connect = function(connectionList, opts, doneCb) {
  const self = this;

  const checkConnect = (next) => {
    this.blockchainConnector.getAccounts((err, _a) => {
      if (err) {
        this.blockchainConnector.setProvider(null);
      }
      return next(null, !err);
    });
  };

  const connectWeb3 = async (next) => {
    if (window.ethereum) {
      try {
        if (Blockchain.autoEnable) {
          await ethereum.enable();
          this.blockchainConnector.setProvider(ethereum);
        }
        return checkConnect(next);
      } catch (error) {
        return next(null, false);
      }
    }

    return next(null, false);
  };

  const connectWebsocket = (value, next) => {
    this.blockchainConnector.setProvider(this.blockchainConnector.getNewProvider('WebsocketProvider', value));
    checkConnect(next);
  };

  const connectHttp = (value, next) => {
    this.blockchainConnector.setProvider(this.blockchainConnector.getNewProvider('HttpProvider', value));
    checkConnect(next);
  };

  this.doFirst(function(cb) {
    reduce(connectionList, false, function(connected, value, next) {
      if (connected) {
        return next(null, connected);
      }

      if (value === '$WEB3') {
        connectWeb3(next);
      } else if (value.indexOf('ws://') >= 0) {
        connectWebsocket(value, next);
      } else {
        connectHttp(value, next);
      }
    }, function(_err, _connected) {
      self.blockchainConnector.getAccounts((err, accounts) => {
        if (opts.warnAboutMetamask) {
          const currentProv = self.blockchainConnector.getCurrentProvider();
          if (currentProv && currentProv.isMetaMask) {
            console.warn("%cNote: Embark has detected you are in the development environment and using Metamask, please make sure Metamask is connected to your local node", "font-size: 2em");
          }
        }
        if (accounts) {
          self.blockchainConnector.setDefaultAccount(accounts[0]);
        }
        cb(err);
        doneCb(err);
      });
    });
  });
};

Blockchain.enableEthereum = function() {
  if (window.ethereum) {
    return ethereum.enable().then((accounts) => {
      this.blockchainConnector.setProvider(ethereum);
      this.blockchainConnector.setDefaultAccount(accounts[0]);
      contracts.forEach(contract => {
        contract.options.from = this.blockchainConnector.getDefaultAccount();
      });
      return accounts;
    });
  }
};

Blockchain.execWhenReady = function(cb) {
  if (this.done) {
    return cb(this.err, this.web3);
  }
  if (!this.list) {
    this.list = [];
  }
  this.list.push(cb);
};

Blockchain.doFirst = function(todo) {
  var self = this;
  todo(function(err) {
    self.done = true;
    self.err = err;
    if (self.list) {
      self.list.map((x) => x.apply(x, [self.err, self.web3]));
    }
  });
};

let Contract = function(options) {
  var self = this;
  var ContractClass;

  this.abi = options.abi;
  this.address = options.address;
  this.gas = options.gas;
  this.code = '0x' + options.code;

  this.web3 = options.web3;
  this.blockchainConnector = Blockchain.blockchainConnector;

  ContractClass = this.blockchainConnector.newContract({abi: this.abi, address: this.address});
  contracts.push(ContractClass);
  ContractClass.options.data = this.code;
  const from = this.from || self.blockchainConnector.getDefaultAccount() || this.web3.eth.defaultAccount;
  if (from) {
    ContractClass.options.from = from;
  }
  ContractClass.abi = ContractClass.options.abi;
  ContractClass.address = this.address;
  ContractClass.gas = this.gas;

  let originalMethods = Object.keys(ContractClass);

  Blockchain.execWhenReady(function(_err, _web3) {
    if (!ContractClass.currentProvider) {
      ContractClass.setProvider(self.blockchainConnector.getCurrentProvider() || self.web3.currentProvider);
    }
    ContractClass.options.from = self.blockchainConnector.getDefaultAccount() ||self.web3.eth.defaultAccount;
  });

  ContractClass._jsonInterface.forEach((abi) => {
    if (originalMethods.indexOf(abi.name) >= 0) {
      console.log(abi.name + " is a reserved word and cannot be used as a contract method, property or event");
      return;
    }

    if (!abi.inputs) {
      return;
    }

    let numExpectedInputs = abi.inputs.length;

    if (abi.type === 'function' && abi.constant) {
      ContractClass[abi.name] = function() {
        let ref = ContractClass.methods[abi.name];
        let call = ref.apply(ref, ...arguments).call;
        return call.apply(call, []);
      };
    } else if (abi.type === 'function') {
      ContractClass[abi.name] = function() {
        let options = {}, cb = null, args = Array.from(arguments || []).slice(0, numExpectedInputs);
        if (typeof (arguments[numExpectedInputs]) === 'function') {
          cb = arguments[numExpectedInputs];
        } else if (typeof (arguments[numExpectedInputs]) === 'object') {
          options = arguments[numExpectedInputs];
          cb = arguments[numExpectedInputs + 1];
        }

        let ref = ContractClass.methods[abi.name];
        let send = ref.apply(ref, args).send;
        return send.apply(send, [options, cb]);
      };
    } else if (abi.type === 'event') {
      ContractClass[abi.name] = function(options, cb) {
        let ref = ContractClass.events[abi.name];
        return ref.apply(ref, [options, cb]);
      };
    }
  });

  return ContractClass;
};

Contract.prototype.deploy = function(args, _options) {
  var self = this;
  var contractParams;
  var options = _options || {};

  contractParams = args || [];

  contractParams.push({
    from: this.blockchainConnector.getDefaultAccount() || this.web3.eth.accounts[0],
    data: this.code,
    gas: options.gas || 800000
  });


  const contractObject = this.blockchainConnector.newContract({abi: this.abi});

  return new Promise(function (resolve, reject) {
    contractParams.push(function(err, transaction) {
      if (err) {
        reject(err);
      } else if (transaction.address !== undefined) {
        resolve(new Contract({
          abi: self.abi,
          code: self.code,
          address: transaction.address
        }));
      }
    });

    contractObject["new"].apply(contractObject, contractParams);
  });
};

Contract.prototype.new = Contract.prototype.deploy;

Contract.prototype.at = function(address) {
  return new Contract({abi: this.abi, code: this.code, address: address});
};

Contract.prototype.send = function(value, unit, _options) {
  let options, wei;
  if (typeof unit === 'object') {
    options = unit;
    wei = value;
  } else {
    options = _options || {};
    wei = this.blockchainConnector.toWei(value, unit);
  }

  options.to = this.address;
  options.value = wei;

  return this.blockchainConnector.send(options);
};

Blockchain.Contract = Contract;

export default Blockchain;

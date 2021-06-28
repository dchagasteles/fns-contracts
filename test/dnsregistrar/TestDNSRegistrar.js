const FNSRegistry = artifacts.require('./FNSRegistry.sol');
const DummyDNSSEC = artifacts.require('./DummyDnsRegistrarDNSSEC.sol');
const Root = artifacts.require("/Root.sol");
const SimplePublixSuffixList = artifacts.require('./SimplePublicSuffixList.sol');
const DNSRegistrarContract = artifacts.require('./DNSRegistrar.sol');
const namehash = require('eth-fns-namehash');
const utils = require('./Helpers/Utils');
const { exceptions } = require('../test-utils');

contract('DNSRegistrar', function(accounts) {
  var registrar = null;
  var fns = null;
  var root = null;
  var dnssec = null;
  var suffixes = null;
  var now = Math.round(new Date().getTime() / 1000);

  beforeEach(async function() {
    fns = await FNSRegistry.new();

    root = await Root.new(fns.address);
    await fns.setOwner('0x0', root.address);

    dnssec = await DummyDNSSEC.new();
    
    suffixes = await SimplePublixSuffixList.new();
    await suffixes.addPublicSuffixes([utils.hexEncodeName("test"), utils.hexEncodeName("co.nz")]);

    registrar = await DNSRegistrarContract.new(dnssec.address, suffixes.address, fns.address);
    await root.setController(registrar.address, true);
  });

  it('allows the owner of a DNS name to claim it in FNS', async function() {
    assert.equal(await registrar.oracle(), dnssec.address);
    assert.equal(await registrar.fns(), fns.address);

    var proof = utils.hexEncodeTXT({
      name: '_fns.foo.test',
      type: 'TXT',
      class: 'IN',
      ttl: 3600,
      data: ['a=' + accounts[0]]
    });

    await dnssec.setData(
      16,
      utils.hexEncodeName('_fns.foo.test'),
      now,
      now,
      proof
    );

    await registrar.claim(utils.hexEncodeName('foo.test'), proof);

    assert.equal(await fns.owner(namehash.hash('foo.test')), accounts[0]);
  });

  it('allows claims on names that are not TLDs', async function() {
    var proof = utils.hexEncodeTXT({
      name: '_fns.foo.co.nz',
      type: 'TXT',
      class: 'IN',
      ttl: 3600,
      data: ['a=' + accounts[0]]
    });

    await dnssec.setData(
      16,
      utils.hexEncodeName('_fns.foo.co.nz'),
      now,
      now,
      proof
    );

    await registrar.claim(utils.hexEncodeName('foo.co.nz'), proof);

    assert.equal(await fns.owner(namehash.hash('foo.co.nz')), accounts[0]);
  });

  it('allows anyone to zero out an obsolete name', async function() {
    await dnssec.setData(
      16,
      utils.hexEncodeName('_fns.foo.test'),
      now,
      now,
      '0x'
    );

    await registrar.claim(utils.hexEncodeName('foo.test'), '0x');

    assert.equal(await fns.owner(namehash.hash('foo.test')), 0);
  });

  it('allows anyone to update a DNSSEC referenced name', async function() {
    var proof = utils.hexEncodeTXT({
      name: '_fns.foo.test',
      type: 'TXT',
      class: 'IN',
      ttl: 3600,
      data: ['a=' + accounts[1]]
    });

    await dnssec.setData(
      16,
      utils.hexEncodeName('_fns.foo.test'),
      now,
      now,
      proof
    );

    await registrar.claim(utils.hexEncodeName('foo.test'), proof);
    assert.equal(await fns.owner(namehash.hash('foo.test')), accounts[1]);
  });

  it('does not allow updates with stale records', async function() {
    var proof = utils.hexEncodeTXT({
      name: '_fns.bar.test',
      type: 'TXT',
      class: 'IN',
      ttl: 3600,
      data: ['a=' + accounts[0]]
    });

    await dnssec.setData(16, utils.hexEncodeName('_fns.foo.test'), 0, 0, proof);

    await exceptions.expectFailure(registrar.claim(utils.hexEncodeName('bar.test'), proof));
  });
});

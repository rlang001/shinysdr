// Copyright 2013, 2014, 2015, 2016, 2017 Kevin Reid and the ShinySDR contributors
// 
// This file is part of ShinySDR.
// 
// ShinySDR is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// 
// ShinySDR is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
// 
// You should have received a copy of the GNU General Public License
// along with ShinySDR.  If not, see <http://www.gnu.org/licenses/>.

'use strict';

define([
  './events',
  './network',
  './types',
  './values',
], (
  import_events,
  import_network,
  import_types,
  import_values
) => {
  const {
    AddKeepDrop,
    Neverfier,
    Notifier,
  } = import_events;
  const {
    externalGet,
    statusCategory,
    xhrpost,
  } = import_network;
  const {
    booleanT,
  } = import_types;
  const {
    StorageCell,
  } = import_values;

  const exports = {};
  
  // Abstract: a source of database records, which might be a concrete table or a view.
  class Source {
    getAll() {
      throw new Error('getAll not overridden!');
    }
    
    getGeneration() {
      throw new Error('getGeneration not overridden!');
    }
    
    _isUpToDate() {
      throw new Error('_isUpToDate not overridden!');
    }
    
    first() {
      return this.getAll()[0];
    }
    
    last() {
      const entries = this.getAll();
      return entries[entries.length - 1];
    }
    
    inBand(lower, upper) {
      return new FilterView(this, function inBandFilter(record) {
        return record.upperFreq >= lower &&
               record.lowerFreq <= upper;
      });
    }
    
    type(type) {
      return new FilterView(this, function typeFilter(record) {
        return record.type === type;
      });
    }
    
    string(str) {
      const re = new RegExp(str, 'i');
      return new FilterView(this, function stringFilter(record) {
        return re.test(record.label) || re.test(record.notes);
      });
    }
    
    groupSameFreq() {
      return new GroupView(this);
    }
    
    forEach(f) {
      this.getAll().forEach(f);
    }
  }
  
  class View extends Source {
    constructor(db) {
      super();
      this._viewGeneration = NaN;
      this._entries = [];
      this._db = db === null ? this : db;  // null is case used by Table
      this.n = this._db.n;
    }
    
    _isUpToDate() {
      return this._viewGeneration === this._db.getGeneration() && this._db._isUpToDate();
    }
    
    getAll() {
      if (!this._isUpToDate()) {
        this._entries = Object.freeze(this._execute(this._db.getAll()));
        this._viewGeneration = this._db.getGeneration();
      }
      return this._entries;
    }
    
    getGeneration() {
      return this._viewGeneration;
    }
  }
  
  class FilterView extends View {
    constructor(db, filter) {
      super(db);
      this._filter = filter;
    }
    
    _execute(baseEntries) {
      return baseEntries.filter(this._filter);
    }
  }
  
  class GroupView extends View {
    constructor(db) {
      super(db);
    }
    
    _execute(baseEntries) {
      let lastFreqL = null;
      let lastFreqH = null;
      let lastGroup = [];
      const out = [];
      function flush() {
        if (lastGroup.length) {
          if (lastGroup.length > 1) {
            out.push(Object.freeze({
              type: 'group',
              lowerFreq: lastFreqL,
              upperFreq: lastFreqH,
              freq: (lastFreqL + lastFreqH) / 2,
              grouped: Object.freeze(lastGroup),
              n: new Neverfier(),
            }));
          } else {
            out.push(lastGroup[0]);
          }
          lastGroup = [];
        }
      }
      baseEntries.forEach(record => {
        // TODO: not grouping bands is not on principle, it's just because FreqScale, the only user of this, doesn't want it. Revisit the design.
        if (record.type === 'band' || record.lowerFreq !== lastFreqL || record.upperFreq !== lastFreqH) {
          flush();
          lastFreqL = record.lowerFreq;
          lastFreqH = record.upperFreq;
        }
        lastGroup.push(record);
      });
      flush();
      return out;
    }
  }
  
  // TODO: Consider switching Union to use a cell as its source. For that matter, consider switching the entire DB system to use DerivedCell — I think it has all the needed properties now. Though db sources don't need a scheduler baked in and DerivedCell does ...
  class Union extends Source {
    constructor() {
      super();
      this._unionSources = [];
      this._sourceGenerations = [];
      this._shrinking = false;
      this._entries = [];
      this._viewGeneration = 0;
      this._listeners = [];
      this._chainedListening = false;
    
      const notifier = new Notifier();
      const forward = () => {
        //console.log(this + ' forwarding');
        this._chainedListening = false;
        notifier.notify();
      };
      this.n = {
        notify: notifier.notify.bind(notifier),
        listen: l => {
          if (!this._chainedListening) {
            //console.group(this + ' registering forwarder');
            this._chainedListening = true;
            forward.scheduler = l.scheduler; // TODO technically wrong
            this._unionSources.forEach(function (source) {
              source.n.listen(forward);
            });
            //console.groupEnd();
          } else {
            //console.log(this + ' locally registering listener');
          }
          notifier.listen(l);
        }
      };
    }
    
    toString() {
      return '[shinysdr.database.Union ' + this._unionSources + ']';
    }
    
    add(source) {
      if (this._unionSources.indexOf(source) !== -1) return;
      this._unionSources.push(source);
      //console.log(this + ' firing notify for adding ' + source);
      this._chainedListening = false;  // no longer complete list
      this.n.notify();
    }
    
    remove(source) {
      if (this._unionSources.indexOf(source) === -1) return;
      this._unionSources = this._unionSources.filter(function (x) { return x !== source; });
      this._sourceGenerations = [];  // clear obsolete info, will be fully rebuilt regardless
      this._shrinking = true;  // TODO kludge, can we not need this extra flag?
      this.n.notify();
    }
    
    getSources() {  // used for db selection tree. TODO better interface
      return this._unionSources.slice();
    }
    
    getAll() {
      if (!this._isUpToDate()) {
        const entries = [];
        this._unionSources.forEach((source, i) => {
          entries.push.apply(entries, source.getAll());
          this._sourceGenerations[i] = source.getGeneration();
        });
        entries.sort(compareRecord);
        this._entries = Object.freeze(entries);
        this._viewGeneration++;
        this._shrinking = false;
      }
      return this._entries;
    }
    
    getGeneration() {
      return this._viewGeneration;
    }
    
    _isUpToDate() {
      return !this._shrinking && this._unionSources.every((source, i) => {
        return source.getGeneration() === this._sourceGenerations[i] && source._isUpToDate();
      });
    }
  }
  exports.Union = Union;
  
  // TODO: Make Table inherit only Source, not View, as it's not obvious what the resulting requirements for how View works are
  class Table extends View {
    constructor(label, writable, initializer, addURL) {
      writable = !!writable;
      super(null);
      this.n = new Notifier();
      this._viewGeneration = 0;
      this._label = label;
      this._triggerFacet = finishModification.bind(this);
      this._addURL = addURL;
      this.writable = !!writable;
      if (initializer) {
        initializer({
          add: (suppliedRecord, url) => {
            this._entries.push(new Record(suppliedRecord, url, this.writable ? this._triggerFacet : null));
          },
          makeWritable: () => {
            if (this._entries.length > 0) {
              throw new Error('too late to makeWritable');
            }
            this.writable = true;
          }
        });
      }
    }
    
    getTableLabel() {  // TODO kludge, reconsider interface
      return this._label;
    }
    
    toString() {
      return '[shinysdr.database.Table ' + this._label + ']';
    }
    
    getAll() {
      if (!this._needsSort) {
        this._entries.sort(compareRecord);
      }
      return this._entries; // TODO return frozen
    }
    
    _isUpToDate() {
      return true;
    }
    
    add(suppliedRecord) {
      if (!this.writable) {
        throw new Error('This table is read-only');
      }
      const record = new Record(suppliedRecord, null, this._triggerFacet);
      this._entries.push(record);
      this._triggerFacet();
    
      if (this._addURL) {
        record._remoteCreate(this._addURL);
      }
    
      return record;
    }
  }
  exports.Table = Table;
  
  function arrayFromCatalog(url, callback) {
    const out = [];
    externalGet(url, 'document').then(indexDoc => {
      const anchors = indexDoc.querySelectorAll('a[href]');
      //console.log('Fetched database index with ' + anchors.length + ' links.');
      Array.prototype.forEach.call(anchors, anchor => {
        // Conveniently, the browser resolves URLs for us here
        out.push(fromURL(anchor.href));
      });
      callback(out);
    });
  }
  exports.arrayFromCatalog = arrayFromCatalog;
  
  function fromURL(url) {
    return new Table(
      decodeURIComponent(url.replace(/^.*\/(?=.)/, '').replace(/(.csv)?(\/)?$/, '')),
      false,
      function (init) {
        // TODO (implicitly) check mime type
        externalGet(url, 'text').then(jsonString => {
          const databaseJson = JSON.parse(jsonString);
          if (databaseJson.writable) {
            init.makeWritable();
          }
          const recordsJson = databaseJson.records;
          for (const key in recordsJson) {
            init.add(recordsJson[key], url + encodeURIComponent(key));
          }
        });
      },
      url);
  }
  exports.fromURL = fromURL;
  
  function compareRecord(a, b) {
    return a.lowerFreq - b.lowerFreq;
  }
  
  function finishModification() {
    // jshint validthis: true
    this._needsSort = true;
    this._viewGeneration++;
    //console.log(this + ' firing notify for modification');
    this.n.notify();
  }
  
  function OptCoord(record) {
    // might want to make this not _re_allocate at some point
    return record === null ? null : Object.freeze([+record[0], +record[1]]);
  }
  function OptNumber(value) {
    return value === null ? NaN : +value;
  }
  function makeRecordProp(name, coerce, defaultValue) {
    const internalName = '_stored_' + name;
    return {
      enumerable: true,
      get: function () {
        return this[internalName];
      },
      set: function (value) {
        if (this._initializing || this._hook) {
          if (this._initializing) {
            Object.defineProperty(this, internalName, {
              enumerable: false,
              writable: true,
              value: coerce(value)
            });
          } else {
            this[internalName] = coerce(value);
          }
          if (this._hook && !this._initializing) {
            const callbackWithoutThis = this._hook;
            callbackWithoutThis();
          }
          this.n.notify();
        } else {
          throw new Error('This record is read-only');
        }
      },
      _my_default: defaultValue
    };
  }
  const recordProps = {
    type: makeRecordProp('type', String, 'channel'), // TODO enum constraint
    mode: makeRecordProp('mode', String, '?'),
    lowerFreq: makeRecordProp('lowerFreq', OptNumber, NaN),
    upperFreq: makeRecordProp('upperFreq', OptNumber, NaN),
    location: makeRecordProp('location', OptCoord, null),
    label: makeRecordProp('label', String, ''),
    notes: makeRecordProp('notes', String, '')
  };
  class Record {
    constructor(initial, url, changeHook) {
      if (changeHook) {
        this._url = url;
      
        // flags to avoid racing spammy updates
        let updating = false;
        let needAgain = false;
        const sendUpdate = () => {
          if (!this._oldState) throw new Error('too early');
          if (!this._url) return;
          if (updating) {
            needAgain = true;
            return;
          }
          updating = true;
          needAgain = false;
          const newState = this.toJSON();
          // TODO: PATCH method would be more specific
          xhrpost(this._url, JSON.stringify({old: this._oldState, new: newState})).then(() => {
            // TODO: Warn user / retry on network errors. Since we don't know whether the server has accepted the change we should retrieve it as new oldState and maybe merge
            updating = false;
            if (needAgain) sendUpdate();
          });
          this._oldState = newState;
        };
      
        this._hook = () => {
          if (changeHook) changeHook();
          // TODO: Changing lowerFreq + upperFreq sends double updates; see if we can coalesce
          sendUpdate();
        };
      } else {
        this._hook = null;
      }
      Object.defineProperties(this, {
        n: { enumerable: false, value: new Notifier() },
        _initializing: { enumerable: false, writable: true, value: true }
      });
      for (const name in recordProps) {
        this[name] = initial.propertyIsEnumerable(name) ? initial[name] : recordProps[name]._my_default;
      }
      if (isFinite(initial.freq)) {
        this.freq = initial.freq;
      }
      // TODO report unknown keys in initial
      this._initializing = false;
      this._oldState = this.toJSON();
      //Object.preventExtensions(this);  // TODO enable this after the _view_element kludge is gone
    }
    
    get writable() { return !!this._hook; }
    
    get freq() {
      return (this.lowerFreq + this.upperFreq) / 2;
    }
    set freq(value) {
      this.lowerFreq = this.upperFreq = value;
    }
    
    toJSON() {
      const out = {};
      for (const k in this) {
        if (recordProps.hasOwnProperty(k)) {
          let value = this[k];
          if (typeof value === 'number' && isNaN(value)) value = null;  // JSON.stringify does this too; this is just to be canonical even if not stringified
          out[k] = value;
        }
      }
      return out;
    }
    
    _remoteCreate(addURL) {
      if (this._url) throw new Error('url already set');
      xhrpost(addURL, JSON.stringify({new: this.toJSON()})).then(r => {
        if (statusCategory(r.status) === 2) {
          if (this._url) throw new Error('url already set');
          this._url = r.getResponseHeader('Location');
          this._hook();  // write updates occurring before url was set
        
        } else {
          // TODO: retry/buffer creation or make the record defunct
          console.error('Record creation failed! ' + r.status, r);
        }
      });
    }
  }
  Object.defineProperties(Record.prototype, recordProps);
  
  class DatabasePicker {
    constructor(scheduler, sourcesCell, storage) {
      const self = this;
      const result = new Union();
    
      this._reshapeNotice = new Notifier();
      Object.defineProperty(this, '_reshapeNotice', {enumerable: false});
      this['_implements_shinysdr.client.database.DatabasePicker'] = true;
      Object.defineProperty(this, '_implements_shinysdr.client.database.DatabasePicker', {enumerable: false});
      this.getUnion = function () { return result; };    // TODO facet instead of giving add/remove access
      Object.defineProperty(this, 'getUnion', {enumerable: false});
    
      let i = 0;
      const sourceAKD = new AddKeepDrop({
        add(source) {
          // TODO get clean stable unique names from the sources
          const label = source.getTableLabel ? source.getTableLabel() : (i++);
          const key = 'enabled_' + label; 
          const cell = new StorageCell(storage, booleanT, true, key);
          self[key] = cell;
          // TODO unbreakable notify loop. consider switching Union to work like, or to take a, DerivedCell.
          scheduler.startNow(function updateUnionFromCell() {
            if (cell.depend(updateUnionFromCell)) {
              result.add(source);
            } else {
              result.remove(source);
            }
          });
        
          self._reshapeNotice.notify();
        },
        remove(source) {
          throw new Error('Removal not implemented');
        }
      });
    
      scheduler.startNow(function updateAKD() {
        sourceAKD.update(sourcesCell.depend(updateAKD));
      });
    }
  }
  exports.DatabasePicker = DatabasePicker;
  
  exports.empty = new Table('(none)', false, function (init) {});
  
  // Generic FM broadcast channels
  exports.fm = (function () {
    // Wikipedia currently says FM channels are numbered like so, but no one uses the numbers. Well, I'll use the numbers, just to start from integers. http://en.wikipedia.org/wiki/FM_broadcasting_in_the_USA
    return new Table('US FM broadcast', false, function (init) {
      for (let channel = 200; channel <= 300; channel++) {
        // not computing in MHz because that leads to roundoff error
        const freq = (channel - 200) * 2e5 + 879e5;
        init.add({
          type: 'channel',
          freq: freq,
          mode: 'WFM',
          label: 'FM ' /*+ channel*/ + (freq / 1e6).toFixed(1)
        });
      }
    });
  }());
  
  // Aircraft band channels
  exports.air = (function () {
    // http://en.wikipedia.org/wiki/Airband
    return new Table('US airband', false, function (init) {
      for (let freq = 108e6; freq <= 117.96e6; freq += 50e3) {
        init.add({
          type: 'channel',
          freq: freq,
          mode: '-',
          label: 'Air nav ' + (freq / 1e6).toFixed(2)
        });
      }
      for (let freq = 118e6; freq < 137e6; freq += 25e3) {
        init.add({
          type: 'channel',
          freq: freq,
          mode: 'AM',
          label: 'Air voice ' + (freq / 1e6).toFixed(2)
        });
      }
    });
  }());
  
  exports.systematics = Object.freeze([
    exports.fm,
    // TODO: This is currently too much clutter. Re-add this sort of info once we have ways to deemphasize repetitive information.
    //exports.air
  ]);
  
  return Object.freeze(exports);
});
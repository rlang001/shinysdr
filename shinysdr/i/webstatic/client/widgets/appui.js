// Copyright 2013, 2014, 2015, 2016, 2017, 2018, 2020 Kevin Reid and the ShinySDR contributors
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
  './basic', 
  '../events',
  '../types', 
  '../values', 
  '../widget'
], (
  {
    Banner,
    Block,
    Knob,
    LinSlider,
    MeasvizWidget,
    Meter,
    Number: NumberWidget,
    PickWidget,
    Radio,
    Select,
    Toggle,
    TextTerminal,
  },
  {
    AddKeepDrop,
  },
  {
    EnumT,
    NoticeT,
  },
  {
    DerivedCell,
    LocalCell,
  },
  {
    createWidgetExt,
  }
) => {
  const exports = {};

  // Suppresses all visibility of null objects
  function NullWidget(config) {
    Block.call(this, config, function () {}, true);
  }
  exports['interface:shinysdr.values.INull'] = NullWidget;
  
  // Widget for the top block
  function Top(config) {
    Block.call(this, config, function (block, addWidget, ignore, setInsertion, setToDetails, getAppend) {
      // TODO: It's a lousy design to require widgets to know what not to show. We should have a generic system for multiple widgets to decide "OK, you'll display this and I won't".
      ignore('monitor');  // displayed separately
      ignore('telemetry_store');  // displayed separately
      
      const sourceToolbar = this.element.appendChild(document.createElement('div'));
      sourceToolbar.className = 'panel frame-controls';
      sourceToolbar.appendChild(document.createTextNode('RF source '));
      if ('source_name' in block) {
        ignore('source_name');
        const sourceEl = sourceToolbar.appendChild(document.createElement('select'));
        createWidgetExt(config.context, Select, sourceEl, block.source_name);
      }
      
      // TODO: Figure out a good way to display options for all devices
      ignore('sources');
      addWidget('source', Device);

      addWidget('clip_warning', Banner);
      addWidget('receivers', ReceiverSet);
      addWidget('accessories', AccessorySet);
      
      setToDetails();
    });
  }
  exports.Top = Top;
  
  function BlockSet(widgetCtor, buildEntry) {
    return function TypeSetInst(config) {
      // We do not inherit from Block, because we don't want the rebuild-on-reshape behavior (so we can do something more efficient) and we don't need the rest of it.
      const block = config.target.depend(config.rebuildMe);
      const idPrefix = config.idPrefix;
      const childContainer = this.element = config.element;
      
      // TODO: We ought to display these in some way.
      config.element.removeAttribute('title');
      
      const childrenAKD = new AddKeepDrop({
        add(name) {
          // buildContainer must append exactly one child. TODO: cleaner
          const widgetPlaceholder = buildEntry(childContainer, block, name);
          if (idPrefix) {
            widgetPlaceholder.id = idPrefix + name;
          }
          const widgetContainer = childContainer.lastChild;
          const widgetHandle = createWidgetExt(config.context, widgetCtor, widgetPlaceholder, block[name]);
          return {
            widgetHandle: widgetHandle,
            element: widgetContainer
          };
        },
        remove(name, parts) {
          parts.widgetHandle.destroy();
          childContainer.removeChild(parts.element);
        }
      });

      config.scheduler.startNow(function handleReshape() {
        block._reshapeNotice.listen(handleReshape);
        childrenAKD.update(Object.keys(block));
      });
    };
  }
  exports.BlockSet = BlockSet;
  
  function BlockSetInFrameEntryBuilder(userTypeName, collapsible) {
    return function blockSetInFrameEntryBuilder(setElement, block, name) {
      const container = setElement.appendChild(document.createElement(collapsible ? 'details' : 'div'));
      container.className = 'frame';
      const toolbar = container.appendChild(document.createElement(collapsible ? 'summary' : 'div'));
      toolbar.className = 'panel frame-controls';
      
      if (block['_implements_shinysdr.values.IWritableCollection']) {
        const del = document.createElement('button');
        del.textContent = '\u2573';
        del.className = 'frame-delete-button';
        toolbar.appendChild(del);
        del.addEventListener('click', function(event) {
          block.delete(name);
        });
      }
      
      toolbar.appendChild(document.createTextNode(' ' + userTypeName + ' '));
      
      const label = document.createElement('span');
      label.textContent = name;
      toolbar.appendChild(label);
      
      return container.appendChild(document.createElement('div'));
    };
  }
  
  function windowEntryBuilder(setElement, block, name, setInsertion) {
    const paneEl = document.createElement('shinysdr-pane');
    paneEl.id = 'section-' + name;  // TODO match block id system instead of this (need context)
    const header = paneEl.appendChild(document.createElement('h2'));
    header.appendChild(document.createTextNode(name));  // TODO formatting
    const body = paneEl.appendChild(document.createElement('div'));
    body.classList.add('sidebar');  // TODO not quite right class -- we want main-ness but scrolling
    body.classList.add('frame');
    
    setElement.appendChild(paneEl);
    return body.appendChild(document.createElement('div'));
  }
  
  function blockSetNoHeader(setElement, block, name, setInsertion) {
    return setElement.appendChild(document.createElement('div'));
  }
  
  // TODO: This is unused but won't be once 'Accessory' is dead
  //exports.DeviceSet = BlockSet(Device, BlockSetInFrameEntryBuilder('Device'));
  const ReceiverSet = exports.ReceiverSet = BlockSet(Receiver, BlockSetInFrameEntryBuilder('Receiver'), false);
  const AccessorySet = exports.AccessorySet = BlockSet(PickWidget, BlockSetInFrameEntryBuilder('', true));
  exports.WindowBlocks = BlockSet(PickWidget, windowEntryBuilder);
  
  // Widget for a device
  function Device(config) {
    Block.call(this, config, function (block, addWidget, ignore, setInsertion, setToDetails, getAppend) {
      const freqCell = block.freq;
      if (!freqCell.type.isSingleValued()) {
        addWidget('freq', Knob, 'Center frequency');
      }
      addWidget('rx_driver', PickWidget);
      addWidget('tx_driver', PickWidget);
      addWidget('components', ComponentSet);
    });
  }
  exports['interface:shinysdr.devices.IDevice'] = Device;
  const ComponentSet = BlockSet(PickWidget, blockSetNoHeader);
  
  // Widget for a RX driver block -- TODO break this stuff up
  function RXDriverWidget(config) {
    Block.call(this, config, function (block, addWidget, ignore, setInsertion, setToDetails, getAppend) {
      // If we have multiple gain-related controls, do a combined UI
      // TODO: Better feature-testing strategy
      const hasAGC = 'agc' in block && !block.agc.type.isSingleValued();
      const hasSingleGain = 'gain' in block;
      const hasMultipleGain = 'gains' in block;
      if (hasAGC + hasSingleGain + hasMultipleGain > 1) (function () {
        const gainModes = {};
        if (hasAGC) { gainModes['auto'] = 'AGC On'; ignore('agc'); }
        if (hasSingleGain) { gainModes['single'] = 'Manual Gain'; }
        if (hasMultipleGain && !(hasSingleGain && Object.keys(block.gains.depend(config.rebuildMe)).length === 1)) {
          // show gain stages UI only if there's more than one
          gainModes['stages'] = 'Stages';
        }
        Object.freeze(gainModes);
        const gainModeT = new EnumT(gainModes);
        const gainModeCell = new LocalCell(gainModeT, block.agc.get() ? 'auto' : 'single');

        const gainPanel = getAppend().appendChild(document.createElement('div'));
        //gainPanel.appendChild(document.createTextNode('Gain '));
        const gainModeControl = gainPanel.appendChild(document.createElement('span'));
        createWidgetExt(config.context, Radio, gainModeControl, gainModeCell);
        
        let singleGainPanel;
        if (hasSingleGain) {
          singleGainPanel = gainPanel.appendChild(document.createElement('div'));
          let singleGainSliderWidgetEl = singleGainPanel.appendChild(document.createElement('div'));
          singleGainSliderWidgetEl.title = '';
          createWidgetExt(config.context, LinSlider, singleGainSliderWidgetEl, block.gain);
          ignore('gain');
        }
        let multipleGainPanel;
        if (hasMultipleGain) {
          multipleGainPanel = gainPanel.appendChild(document.createElement('div'));
          createWidgetExt(config.context, Block, multipleGainPanel.appendChild(document.createElement('div')), block.gains);
          ignore('gains');
        }
        
        function setIfDifferent(cell, value) {
          // TODO this function should be a more widely available utility
          if (cell.get() !== value) {
            cell.set(value);
          }
        }
        config.scheduler.startNow(function bindGainModeSet() {
          const mode = gainModeCell.depend(bindGainModeSet);
          if (hasAGC) {
            setIfDifferent(block.agc, mode === 'auto');
          }
        });
        config.scheduler.startNow(function bindGainModeGet() {
          if (hasAGC && block.agc.depend(bindGainModeGet)) {
            setIfDifferent(gainModeCell, 'auto');
          } else if (gainModeCell.get() === 'auto') {
            setIfDifferent(gainModeCell, 'single');
          }
        });
        config.scheduler.startNow(function updateUI() {
          const mode = gainModeCell.depend(updateUI);
          if (hasSingleGain) {
            singleGainPanel.style.display = mode === 'single' ? 'block' : 'none';
          }
          if (hasMultipleGain) {
            multipleGainPanel.style.display = mode === 'stages' ? 'block' : 'none';
          }
        });
      }());
      
      setToDetails();
      
      ignore('output_type');
    }, true);
  }
  exports['interface:shinysdr.devices.IRXDriver'] = RXDriverWidget;
  
  function TXDriverWidget(config) {
    Block.call(this, config, function (block, addWidget, ignore, setInsertion, setToDetails, getAppend) {
      ignore('input_type');  // TODO this should be handled by server-defined metadata
    }, true);
  }
  exports['interface:shinysdr.devices.ITXDriver'] = TXDriverWidget;
  
  // Widget for a receiver block
  function Receiver(config) {
    Block.call(this, config, function (block, addWidget, ignore, setInsertion, setToDetails, getAppend) {
      const deviceAndFreqPanel = getAppend().appendChild(document.createElement('div'));
      deviceAndFreqPanel.classList.add('panel');

      // RF source and link option
      const deviceSection = deviceAndFreqPanel.appendChild(document.createElement('div'));
      deviceSection.classList.add('widget-Receiver-device-controls');
      const hasDeviceMenu = !block.device_name.type.isSingleValued();
      if (hasDeviceMenu) {
        // deviceSection.appendChild(document.createTextNode('Input from '));
        const deviceMenu = deviceSection.appendChild(document.createElement('select'));
        createWidgetExt(config.context, Select, deviceMenu, block.device_name);
        ignore('device_name');
      } else {
        deviceSection.appendChild(document.createTextNode('Frequency '));
        ignore('device_name');
      }
      if ('freq_linked_to_device' in block) {
        const linkLabel = deviceSection.appendChild(document.createElement('label'));
        const linkCheckbox = linkLabel.appendChild(document.createElement('input'));
        linkLabel.appendChild(document.createTextNode(' Follow device'));
        linkCheckbox.type = 'checkbox';
        createWidgetExt(config.context, Toggle, linkCheckbox, block.freq_linked_to_device);
        ignore('freq_linked_to_device');
      }
      
      const knobContainer = deviceAndFreqPanel.appendChild(document.createElement('div'));
      createWidgetExt(config.context, Knob, knobContainer, block.rec_freq);
      ignore('rec_freq');
      
      const outOfRangeNotice = new DerivedCell(new NoticeT(false), config.scheduler, function(dirty) {
        return block.is_valid.depend(dirty)
          ? ''
          : 'Outside of device bandwidth; disabled.';
      });
      addWidget(outOfRangeNotice, Banner);
      ignore('is_valid');
      
      addWidget('mode', Radio);
      addWidget('demodulator', Demodulator);
      
      const saveInsert = getAppend();
      const audioPanel = saveInsert.appendChild(document.createElement('table'));
      audioPanel.classList.add('panel');
      audioPanel.classList.add('aligned-controls-table');
      setInsertion(audioPanel);

      // TODO pick some cleaner way to produce all this html
      ignore('audio_power');
      const powerRow = audioPanel.appendChild(document.createElement('tr'));
      powerRow.appendChild(document.createElement('th')).appendChild(document.createTextNode('Audio'));
      const meter = powerRow.appendChild(document.createElement('td')).appendChild(document.createElement('meter'));
      createWidgetExt(config.context, Meter, meter, block.audio_power);
      const meterNumber = powerRow.appendChild(document.createElement('td')).appendChild(document.createElement('tt'));
      createWidgetExt(config.context, NumberWidget, meterNumber, block.audio_power);

      ignore('audio_gain');
      const gainRow = audioPanel.appendChild(document.createElement('tr'));
      gainRow.appendChild(document.createElement('th')).appendChild(document.createTextNode('Vol'));
      const gainSlider = gainRow.appendChild(document.createElement('td')).appendChild(document.createElement('input'));
      gainSlider.type = 'range';
      createWidgetExt(config.context, LinSlider, gainSlider, block.audio_gain);
      const gainNumber = gainRow.appendChild(document.createElement('td')).appendChild(document.createElement('tt'));
      createWidgetExt(config.context, NumberWidget, gainNumber, block.audio_gain);
      
      const otherRow = audioPanel.appendChild(document.createElement('tr'));
      otherRow.appendChild(document.createElement('th')).appendChild(document.createTextNode('Dest'));
      const otherCell = otherRow.appendChild(document.createElement('td'));
      otherCell.colSpan = 2;
      const otherBox = otherCell.appendChild(document.createElement('span'));
      otherBox.classList.add('widget-Receiver-audio-dest-controls');
      ignore('audio_destination');
      const dest = otherBox.appendChild(document.createElement('select'));
      createWidgetExt(config.context, Select, dest, block.audio_destination);
      if (!block.audio_pan.type.isSingleValued()) {
        ignore('audio_pan');
        otherBox.appendChild(document.createTextNode(' L'));
        const panSlider = otherBox.appendChild(document.createElement('input'));
        panSlider.type = 'range';
        createWidgetExt(config.context, LinSlider, panSlider, block.audio_pan);
        otherBox.appendChild(document.createTextNode('R'));
      }
      
      setInsertion(saveInsert);
      
      if ('rec_freq' in block) {
        addWidget(null, SaveButton);
      }
    });
  }
  exports.Receiver = Receiver;
  
  // Widget for a demodulator block
  function Demodulator(config) {
    Block.call(this, config, function (block, addWidget, ignore, setInsertion, setToDetails, getAppend) {
      ignore('band_shape');
      if ('rf_power' in block && 'squelch_threshold' in block) (function() {
        const squelchAndPowerPanel = this.element.appendChild(document.createElement('table'));
        squelchAndPowerPanel.classList.add('panel');
        squelchAndPowerPanel.classList.add('aligned-controls-table');
        function addRow(label, wtarget, wclass, wel) {
          ignore(wtarget);
          const row = squelchAndPowerPanel.appendChild(document.createElement('tr'));
          row.appendChild(document.createElement('th'))
            .appendChild(document.createTextNode(label));
          const widgetEl = row.appendChild(document.createElement('td'))
            .appendChild(document.createElement(wel));
          if (wel === 'input') widgetEl.type = 'range';
          createWidgetExt(config.context, wclass, widgetEl, block[wtarget]);
          const numberEl = row.appendChild(document.createElement('td'))
            .appendChild(document.createElement('tt'));
          createWidgetExt(config.context, NumberWidget, numberEl, block[wtarget]);
        }
        addRow('RF', 'rf_power', Meter, 'meter');
        addRow('Squelch', 'squelch_threshold', LinSlider, 'input');
      }.call(this)); else {
        // one of these is missing, use independently-conditional fallback
        addWidget('rf_power', Meter, 'Power');
        addWidget('squelch_threshold', LinSlider, 'Squelch');
      }
      
      // TODO: This is plugin stuff; let the plugin (or server-provided metadata) define it.
      // VOR
      addWidget('angle', config.context.widgets.VOR$Angle, '');
      ignore('zero_point');
      // RTTY/PSK31
      addWidget('text', TextTerminal, '');
    }, true);
  }
  exports['interface:shinysdr.interfaces.IDemodulator'] = Demodulator;
  
  // Silly single-purpose widget 'till we figure out more where the UI is going
  // TODO: Inherit from CommandButton
  function SaveButton(config) {
    const receiver = config.target.get();
    const selectedRecord = config.actions.selectedRecord;
    const panel = this.element = config.element;
    panel.classList.add('panel');
    
    let button = panel.querySelector('button');
    if (!button) {
      button = panel.appendChild(document.createElement('button'));
      button.textContent = '+ Save to database';
    }
    button.disabled = false;
    button.onclick = function (event) {
      const record = {
        type: 'channel',
        freq: receiver.rec_freq.get(),
        mode: receiver.mode.get(),
        label: 'untitled'
      };
      selectedRecord.set(config.writableDB.add(record));
    };
  }
  exports.SaveButton = SaveButton;
  
  // TODO: Needs to be more than just a BlockSet: eventually a table with grouped headings and sorting, maybe
  const TelemetryStoreWidget = BlockSet(PickWidget, BlockSetInFrameEntryBuilder('', false));
  exports['interface:shinysdr.telemetry.ITelemetryStore'] = TelemetryStoreWidget;
  
  function AudioStreamStatusWidget(config) {
    Block.call(this, config, function (block, addWidget, ignore, setInsertion, setToDetails, getAppend) {
      addWidget('requested_sample_rate', Select);
      addWidget('buffered', MeasvizWidget);
      addWidget('target', PickWidget, 'Target latency');  // TODO: label should not need to be repeated here
      addWidget('error');
      ignore('monitor');

      // TODO: Get URL/template from server.
      const altStreamLinkPanel = getAppend().appendChild(document.createElement('div'));
      altStreamLinkPanel.classList.add('panel');
      const altStreamLinkAnchor = altStreamLinkPanel.appendChild(document.createElement('a'));
      altStreamLinkAnchor.textContent = 'Direct link to audio stream (experimental, latency will be high)';
      config.scheduler.startNow(function setStreamLink() {
        altStreamLinkAnchor.href = 'audio-stream?rate=' + block.requested_sample_rate.depend(setStreamLink);
      });
    });
  }
  exports['interface:shinysdr.client.audio.AudioStreamStatus'] = AudioStreamStatusWidget;
  
  class ThemeApplier {
    constructor(config) {
      const element = this.element = config.element;
      const target = config.target;
      
      if (element.tagName !== 'LINK') {
        throw new Error('wrong element ' + element.nodeName);
      }
      
      config.scheduler.startNow(function update() {
        let themeUrl = target.depend(update);
        // If value is not valid take a valid one
        // TODO: implement client side coercion and remove this instanceof
        if (target.type instanceof EnumT && !target.type.getEnumTable().has(themeUrl)) {
          themeUrl = Object.keys(target.type.getEnumTable())[0];
        }
        element.href = themeUrl;
      });
    }
  }
  exports.ThemeApplier = ThemeApplier;
  
  return Object.freeze(exports);
});

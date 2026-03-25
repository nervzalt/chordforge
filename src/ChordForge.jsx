import React from 'react';

const ChordForge = () => {
    const [chords, setChords] = React.useState([]);
    const [input, setInput] = React.useState('');

    const handleAddChord = () => {
        if (input) {
            setChords([...chords, input]);
            setInput('');
        }
    };

    const handleRemoveChord = (index) => {
        const newChords = [...chords];
        newChords.splice(index, 1);
        setChords(newChords);
    };

    return (
        <div>
            <h1>ChordForge</h1>
            <input 
                type="text" 
                value={input} 
                onChange={(e) => setInput(e.target.value)} 
                placeholder="Enter chord"
            />
            <button onClick={handleAddChord}>Add Chord</button>
            <ul>
                {chords.map((chord, index) => (
                    <li key={index}>
                        {chord} <button onClick={() => handleRemoveChord(index)}>Remove</button>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default ChordForge;